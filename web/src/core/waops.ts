// Runs what the Tab list handed over (core/waop.ts checked it). Only the person's own click in the panel produces one.
import { sendWaReply, sendWaTemplate, setWaSeen } from "./waactions";
import type { WaOp } from "./waop";
export { cleanWaOp } from "./waop";

export async function runWaOp(o: WaOp): Promise<void> {
  if (o.op === "send") await sendWaReply(o.chatId, o.text);
  else if (o.op === "template") await sendWaTemplate(o.chatId, o.name, o.language);
  else await setWaSeen(o.chatId);
}
