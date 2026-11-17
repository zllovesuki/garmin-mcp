# Using garmin-mcp

## Connect an assistant

After deployment, use `https://<your-hostname>/mcp` as the remote MCP URL. A
normal website visit is not the connection process: the MCP client discovers
Access's OAuth endpoints, opens your sign-in flow, and saves its own credentials.
The Garmin API key never goes into the assistant's connector settings or chat.

In ChatGPT, open Plugins, choose **Add custom MCP server**, enter the URL, and
choose OAuth. Use dynamic client registration when selecting a registration mode.
Install the resulting plugin, then select it in a conversation. Available options
depend on account and workspace settings. See the
[current ChatGPT instructions](https://developers.openai.com/api/docs/guides/custom-mcp-server).

In Claude, open **Customize → Connectors → Add custom connector**, enter the same
URL, and complete sign-in. If asked how to identify the OAuth client, choose
**Register automatically** for Access's managed registration flow. Enable the
connector in the conversation. See the
[current Claude instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

The first sign-in uses Cloudflare Access and your configured identity provider. Only the configured owner
can use this service. The two assistants have independent OAuth connections.

## Questions to try

“Analyze my workouts for the past four weeks. Compare weekly volume and intensity,
identify changes in consistency, and cite the activities behind your conclusions.
Tell me what data is missing.”

“Compare my last three runs. Look at pace, heart rate, cadence, and training effect.
Use the individual laps where the overall averages hide a difference.”

“For my latest interval session, compare the workout targets with the recorded
laps. Identify which steps I completed above or below target.”

“Review my strength sessions this month. Compare sets, repetitions, and weights
for exercises that appear more than once.”

“Compare my training this week with sleep and HRV, where available. Separate
observed patterns from speculation.”

For the four-week review, the assistant can first obtain weekly totals and the
activity list, then fetch selected recordings and health data. The Worker performs
aggregation and decoding; ChatGPT or Claude interprets the results. A Garmin API
key alone does not create an autonomous coach or a scheduled report.

## Tool reference

| Tool                     | Use                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `list_activities`        | Search by inclusive local dates, sport, and name; follow `next_offset`              |
| `get_activity`           | Read summary measurements and available split summaries                             |
| `get_activity_workouts`  | Read instructions and targets attached to an activity                               |
| `get_activity_recording` | Read FIT sessions, laps, strength/rest sets, workout steps, and sampled sensor data |
| `get_health_summary`     | Read daily wellness, sleep, HRV, and weight over an inclusive date range            |
| `summarize_training`     | Calculate Monday-based weekly totals by sport and report coverage                   |
| `get_connection_status`  | Verify Garmin access without returning the profile or credentials                   |

Use explicit `YYYY-MM-DD` dates and string activity IDs. Health dates follow
Garmin's calendar dates; training grouping uses each activity's local start date.
Multisport child activities are excluded from search and totals to avoid counting
both the parent and its legs.

Workout instructions describe intended execution. Recorded laps and sensor
measurements describe what happened. FIT data depends on what the device recorded;
an unstructured activity can have laps but no workout steps. Detailed samples are
limited and can be irregularly spaced. Do not use sampled records to infer exact
time-in-zone or peaks that were not returned. Prefer recorded summary metrics for
those questions.

Every successful result includes a fetch timestamp and unit information where
relevant. Check `complete`, measurement counts, pagination, and `truncated` before
making claims about an entire period. An empty sleep or HRV result is missing data,
not evidence of poor sleep or zero HRV. Queries return information from Garmin's
cloud after the device syncs, not a live stream from the watch.

## Connection problems

If sign-in loops or the client sees an HTML login page, confirm that Managed OAuth
is enabled and the client's exact redirect URI is allowed. An ordinary Access
browser policy alone is insufficient for the remote MCP connection.

A `403` after sign-in can mean the Access application audience or owner email
does not match the Worker configuration. A Garmin authentication error instead
means the personal key needs checking or replacement; repeating the Access sign-in does
not repair that key.

For Garmin rate limits, respect the reported retry delay. For an incomplete
training summary, narrow the dates. For an oversized recording, activity summaries
remain available even when detailed FIT decoding cannot run.
