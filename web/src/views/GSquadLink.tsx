// A G Squad invite link opened in a browser (cincee.com/client/gsquad#...). Joining happens in PS, where your vault
// keys are, so this page only says where to go (V1.49: PS joins The G Squad by itself, no link needed). The part after the # never leaves this browser: nothing here
// sends anything anywhere, and the page never reads the secret, only checks that the link looks whole.
import { parseSquadInvite } from "../core/squadcrypto";
import "./gsquad.css";

export function GSquadLink() {
  const whole = !!parseSquadInvite(location.hash);
  return (
    <main className="gsl">
      <div className="gsl-card">
        <h1>You are invited to The G Squad</h1>
        {whole ? <>
          <p>Open PS app and sign in: PS app puts you in The G Squad by itself, so you do not need this link any more. To see it, open G Squad (on a Mac: hold Tab and click the G Squad icon at the top right of your list; on a phone: the menu at the top left).</p>
          <p className="gsl-small">The key in this link stays on your devices: it is never sent to any server.</p>
        </> : <p>This link is not complete. Ask the person who sent it for a new one.</p>}
      </div>
    </main>
  );
}
