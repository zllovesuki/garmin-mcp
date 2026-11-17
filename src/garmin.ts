const API_ORIGIN = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const MAX_JSON_BYTES = 2 * 1024 * 1024;

export class GarminError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly retryAfterSeconds?: number,
	) {
		super(message);
	}
}

interface Token {
	value: string;
	expiresAt: number;
}

/** Bounds the actual body, including chunked responses without Content-Length. */
async function readBody(response: Response, limit: number): Promise<Uint8Array> {
	if (Number(response.headers.get("content-length")) > limit) {
		await response.body?.cancel();
		throw new GarminError(
			"response_too_large",
			"Garmin returned more data than this request can handle.",
		);
	}
	const reader = response.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) {
				await reader.cancel();
				throw new GarminError(
					"response_too_large",
					"Garmin returned more data than this request can handle.",
				);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.length;
	}
	return body;
}

function httpError(response: Response, authenticating = false): GarminError {
	if (response.status === 429) {
		const raw = response.headers.get("retry-after");
		const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
		return new GarminError(
			"garmin_rate_limited",
			"Garmin is rate limiting requests. Try again later.",
			seconds,
		);
	}
	if (
		response.status === 401 ||
		response.status === 403 ||
		(authenticating && response.status === 400)
	) {
		return new GarminError(
			"garmin_auth_failed",
			"Garmin rejected the credential. Check whether the personal API key expired or was revoked.",
		);
	}
	if (response.status === 404)
		return new GarminError(
			"garmin_not_found",
			"Garmin has no data at this endpoint for the requested activity.",
		);
	return new GarminError(
		"garmin_request_failed",
		`Garmin could not complete the request (HTTP ${response.status}).`,
	);
}

/** One request-scoped client; KV is a disposable cache, never an authorization source. */
export class GarminClient {
	private tokenPromise?: Promise<Token>;
	private cacheKeyPromise?: Promise<string>;

	constructor(
		private readonly key: string,
		private readonly cache: Pick<KVNamespace, "get" | "put">,
		private readonly signal?: AbortSignal,
		private readonly fetcher: typeof fetch = fetch,
	) {}

	private cacheKey(): Promise<string> {
		this.cacheKeyPromise ??= crypto.subtle
			.digest("SHA-256", new TextEncoder().encode(this.key.trim()))
			.then(
				(digest) =>
					`token:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
			);
		return this.cacheKeyPromise;
	}

	private async request(path: string, init: RequestInit = {}): Promise<Response> {
		const timeout = AbortSignal.timeout(15_000);
		const fetcher = this.fetcher;
		try {
			return await fetcher(`${API_ORIGIN}${path}`, {
				...init,
				redirect: "manual",
				signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
			});
		} catch {
			throw new GarminError(
				"garmin_unavailable",
				"Garmin could not be reached or the request timed out.",
			);
		}
	}

	private async obtainToken(force: boolean): Promise<Token> {
		if (!this.key?.trim() || /\s/.test(this.key.trim())) {
			throw new GarminError(
				"garmin_key_missing",
				"Configure the GARMIN_PERSONAL_API_KEY Worker secret.",
			);
		}
		const cacheKey = await this.cacheKey();
		if (!force) {
			try {
				const cached = await this.cache.get<Token>(cacheKey, "json");
				if (
					cached &&
					typeof cached.value === "string" &&
					Number.isFinite(cached.expiresAt) &&
					cached.expiresAt > Date.now() / 1000 + 300
				)
					return cached;
			} catch {
				/* A missing or damaged cache must not prevent a fresh exchange. */
			}
		}
		const response = await this.request(TOKEN_PATH, {
			method: "POST",
			headers: { Authorization: `ApiKey ${this.key.trim()}`, Accept: "*/*" },
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw httpError(response, true);
		}
		const value = new TextDecoder().decode(await readBody(response, 16_384)).trim();
		let expiresAt: number;
		try {
			// This token came directly from Garmin over HTTPS. exp only schedules
			// cache renewal; it is never used to authenticate our MCP callers.
			const encoded = value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
			const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))) as {
				exp?: unknown;
			};
			if (
				typeof claims.exp !== "number" ||
				!Number.isFinite(claims.exp) ||
				claims.exp <= Date.now() / 1000
			)
				throw new Error();
			expiresAt = Math.min(claims.exp, Math.floor(Date.now() / 1000) + 86_400);
		} catch {
			throw new GarminError(
				"garmin_invalid_token",
				"Garmin returned an unexpected token response.",
			);
		}
		const token = { value, expiresAt };
		try {
			await this.cache.put(cacheKey, JSON.stringify(token), { expiration: expiresAt });
		} catch {
			/* A cache write is optional; use the freshly issued token now. */
		}
		return token;
	}

	private token(force = false): Promise<Token> {
		if (force || !this.tokenPromise) this.tokenPromise = this.obtainToken(force);
		return this.tokenPromise;
	}

	private async read(path: string, limit: number, accept: string): Promise<Uint8Array | null> {
		for (let attempt = 0; attempt < 2; attempt++) {
			const token = await this.token(attempt === 1);
			const response = await this.request(path, {
				headers: { Authorization: `Bearer ${token.value}`, Accept: accept },
			});
			if (response.status === 401 && attempt === 0) {
				await response.body?.cancel();
				continue;
			}
			if (!response.ok) {
				await response.body?.cancel();
				throw httpError(response);
			}
			if (response.status === 204) return null;
			try {
				return await readBody(response, limit);
			} catch (error) {
				if (error instanceof GarminError) throw error;
				throw new GarminError(
					"garmin_unavailable",
					"Garmin's response was interrupted or timed out.",
				);
			}
		}
		throw new GarminError("garmin_auth_failed", "Garmin rejected the renewed access token.");
	}

	async json(path: string): Promise<unknown> {
		const body = await this.read(path, MAX_JSON_BYTES, "application/json");
		if (!body) return null;
		try {
			return JSON.parse(new TextDecoder().decode(body)) as unknown;
		} catch {
			throw new GarminError("garmin_invalid_data", "Garmin returned an unexpected data format.");
		}
	}

	async activityFile(activityId: string, limit: number): Promise<Uint8Array> {
		const body = await this.read(`/download-service/files/activity/${activityId}`, limit, "*/*");
		if (!body?.length)
			throw new GarminError(
				"garmin_no_file",
				"This activity has no original recording to download.",
			);
		return body;
	}
}
