// Left out of the public source: email cards, replies and mail sending. It only runs on the developer's own account, so this
// placeholder keeps the names the rest of the app imports and does nothing (scripts in the private tree:
// open-source.mjs). See README.md, "What is left out".
const inert: any = new Proxy(function () {}, {
  get: (_t: unknown, k: string | symbol): any => (k === Symbol.toPrimitive ? () => "" : k === "then" ? undefined : k === Symbol.iterator ? function* () {} : inert),
  apply: () => undefined,
  construct: () => ({}),
});
const _v0: any = { text: "", html: "" };
const _v1: any = { cardId: "", via: "instantly", account: "", to: "", toName: "", first: "", name: "", company: "", subject: "", threadId: "", clientIds: [], emailId: "", quote: { at: "", who: "", text: "" } };
const _v2: any = { cardId: "", via: "instantly", account: "", to: "", toName: "", first: "", name: "", company: "", subject: "", threadId: "", clientIds: [], emailId: "", quote: { at: "", who: "", text: "" } };
const _v3: any = [];
const _v4: any = { sig: "", sigs: undefined, responses: [], send: { random: false, min: 0, max: 0 }, at: "" };
const _v5: any = { sig: "", sigs: undefined, responses: [], send: { random: false, min: 0, max: 0 }, at: "" };
const _v6: any = [];
const _v7: any = [];
const _v8: any = { random: false, min: 0, max: 0 };
const _v9: any = { random: false, min: 0, max: 0 };
const _v10: any = { id: "", cardId: "", via: "instantly", account: "", to: "", toName: "", subject: "", text: "", html: "", threadId: "", emailId: "", sendAt: 0, createdAt: 0, draft: { message: "", sig: "", quote: false, ctx: { cardId: "", via: undefined, account: "", to: "", toName: "", first: "", name: "", company: "", subject: "", threadId: "", clientIds: [], emailId: "", quote: undefined } } };
const _v11: any = { first: "", name: "", company: "", email: "" };
const _v12: any = [];
const _v13: any = { random: false, min: 0, max: 0 };
const _v14: any = [];
export function fillPlaceholders(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function reSubject(_p0?: any, ..._more: any[]): string { return ""; }
export function quoteHeader(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function buildBodies(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): { [k: string]: any; text: any; html: any } { return _v0; }
export function ctxFromGmail(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): { [k: string]: any; cardId: any; via: "instantly" | "gmail"; account: any; to: any; toName: any; first: any; name: any; company: any; subject: any; threadId: any; clientIds: any[]; emailId: any; quote: { [k: string]: any; at: any; who: any; text: any } } { return _v1; }
export function ctxFromLead(_p0?: any, _p1?: any, ..._more: any[]): { [k: string]: any; cardId: any; via: "instantly" | "gmail"; account: any; to: any; toName: any; first: any; name: any; company: any; subject: any; threadId: any; clientIds: any[]; emailId: any; quote: { [k: string]: any; at: any; who: any; text: any } } { return _v2; }
export function starterResponses(_p0?: any, ..._more: any[]): any[] { return _v3; }
export function sigFor(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function cleanMailReplyOp(_p0?: any, ..._more: any[]): any { return undefined; }
export function applyMailReplyOp(_p0?: any, _p1?: any, _p2?: any, _p3?: any, ..._more: any[]): { [k: string]: any; sig?: any; sigs?: any; responses?: any[]; send?: { [k: string]: any; random: any; min: any; max: any }; at?: any } { return _v4; }
export function mergeMailReply(_p0?: any, _p1?: any, ..._more: any[]): { [k: string]: any; sig?: any; sigs?: any; responses?: any[]; send?: { [k: string]: any; random: any; min: any; max: any }; at?: any } { return _v5; }
export function clientsForSender(_p0?: any, _p1?: any, ..._more: any[]): any[] { return _v6; }
export function responsesFor(_p0?: any, _p1?: any, _p2?: any, _p3?: any, ..._more: any[]): any[] { return _v7; }
export function sendSetupHint(_p0?: any, _p1?: any, _p2?: any, _p3?: any, ..._more: any[]): string { return ""; }
export function cleanSendMode(_p0?: any, ..._more: any[]): { [k: string]: any; random: any; min: any; max: any } { return _v8; }
export function randomDelayMs(_p0?: any, _p1?: (...a: any[]) => any, ..._more: any[]): number { return 0; }
export function stepRange(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): { [k: string]: any; random: any; min: any; max: any } { return _v9; }
export function stepMins(_p0?: any, _p1?: any, _p2?: any, ..._more: any[]): number { return 0; }
export function sendsAtText(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export function parseWhen(_p0?: any, _p1?: any, ..._more: any[]): number { return 0; }
export function makeJob(_p0?: any, _p1?: any, _p2?: any, _p3?: any, _p4?: any, ..._more: any[]): { [k: string]: any; id: any; cardId: any; via: "instantly" | "gmail"; account: any; to: any; toName: any; subject: any; text: any; html: any; threadId: any; emailId: any; sendAt: any; createdAt: any; draft: { [k: string]: any; message: any; sig: any; quote: any; ctx: { [k: string]: any; cardId: any; via: any; account: any; to: any; toName: any; first: any; name: any; company: any; subject: any; threadId: any; clientIds: any[]; emailId: any; quote: any } } } { return _v10; }
export function rowText(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export type SavedResponse = { [k: string]: any; id: any; name: any; text: any; clients?: any[] };
export type SendMode = { [k: string]: any; random: any; min: any; max: any };
export type MailReplyPrefs = { [k: string]: any; sig?: any; sigs?: any; responses?: any[]; send?: { [k: string]: any; random: any; min: any; max: any }; at?: any };
export type Via = any;
export type ReplyCtx = { [k: string]: any; cardId: any; via: "instantly" | "gmail"; account: any; to: any; toName: any; first: any; name: any; company: any; subject: any; threadId: any; clientIds: any[]; emailId: any; quote: { [k: string]: any; at: any; who: any; text: any } };
export type ReplyJob = { [k: string]: any; id: any; cardId: any; via: "instantly" | "gmail"; account: any; to: any; toName: any; subject: any; text: any; html: any; threadId: any; emailId: any; sendAt: any; createdAt: any; draft: { [k: string]: any; message: any; sig: any; quote: any; ctx: any } };
export const LIMITS: { [k: string]: any; message: any; sig: any; respName: any; respText: any; responses: any; subject: any } = { message: 0, sig: 0, respName: 0, respText: 0, responses: 0, subject: 0 };
export const UNDO_SECONDS: number = 0;
export const QUICK: any[] = [];
export const SCHED: { [k: string]: any; min: any; max: any; step: any; bigStep: any; start: any } = { min: 0, max: 0, step: 0, bigStep: 0, start: 0 };
export function validEmail(_p0?: any, ..._more: any[]): boolean { return false; }
export function oneLine(_p0?: any, _p1?: any, ..._more: any[]): string { return ""; }
export type Fill = { [k: string]: any; first: any; name: any; company: any; email: any };
export function fillOf(_p0?: any, ..._more: any[]): { [k: string]: any; first: any; name: any; company: any; email: any } { return _v11; }
export const PLACEHOLDERS: any[] = [];
export function responsesOf(_p0?: any, _p1?: any, ..._more: any[]): any[] { return _v12; }
export type MailReplyOp = any;
export function firstWords(_p0?: any, ..._more: any[]): string { return ""; }
export function isGeneral(_p0?: any, ..._more: any[]): boolean { return false; }
export const SEND_RANGE: { [k: string]: any; min: any; max: any; defMin: any; defMax: any } = { min: 0, max: 0, defMin: 0, defMax: 0 };
export const DEFAULT_SEND: { [k: string]: any; random: any; min: any; max: any } = { random: false, min: 0, max: 0 };
export function sendModeOf(_p0?: any, ..._more: any[]): { [k: string]: any; random: any; min: any; max: any } { return _v13; }
export function hhmm(_p0?: any, ..._more: any[]): string { return ""; }
export function clampMins(_p0?: any, ..._more: any[]): number { return 0; }
export function inText(_p0?: any, ..._more: any[]): string { return ""; }
export type OutState = any;
export type OutRow = { [k: string]: any; id: any; cardId: any; via: "instantly" | "gmail"; account: any; to: any; toName: any; subject: any; sendAt: any; state: "queued" | "failed" | "cancelled" | "sent" | "sending"; error?: any; undo?: any };
export function queueOrder(_p0?: any, ..._more: any[]): any[] { return _v14; }
