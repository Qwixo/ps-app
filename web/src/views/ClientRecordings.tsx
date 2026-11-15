// The client's page shows their screen recordings (PS 1.60, pull request 12c), so sales calls can be watched back. Matched from the
// meeting's attendees to this client (core/recordings.ts matchClient, the same matcher as Gmail replies). Shows nothing while screen
// recording is off and nothing has ever been recorded.
import { RecordingsPanel, useRecItems } from "../soundboard/Recordings";
import { REC_WORDS } from "../core/recordings";

export function ClientRecordings({ clientId }: { clientId: string }) {
  const { on } = useRecItems();
  if (!on) return null;
  return (
    <section className="panel stack tight cv-recordings" aria-label={REC_WORDS.clientSection}>
      <h2 className="h3">{REC_WORDS.clientSection}</h2>
      <RecordingsPanel clientId={clientId} />
    </section>
  );
}
