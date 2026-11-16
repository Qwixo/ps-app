// G Squad v3 (PS 1.65): the small rules of the group card. The data side checks them again (squad/dmview.ts cleanDmOp, core/squaddm.ts
// cleanTitle): a group has 2 to 23 other people (3 to 24 with you) and a short name. This only stops a button that would be refused.
import { cleanTitle } from "./squaddm.ts";
export const GROUP_MIN_OTHERS = 2;
export const GROUP_MAX_OTHERS = 23;
export const groupTitleOk = (t: string): boolean => cleanTitle(t).length >= 1;   // the same cleaning the data side does
