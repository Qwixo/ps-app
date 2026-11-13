// THE DEVELOPER'S GOLDEN RULE (mirrors ps-mac/Sources/Protected.swift): PS never looks at or touches
// 1Password or Signal. Anything about them that ever reaches the page is dropped, never shown or saved.
// (On the phone: org.thoughtcrime.securesms is Signal, com.onepassword.android and com.agilebits.onepassword are 1Password.)
export const isProtectedApp = (id: string) => /1password|onepassword|agilebits|whispersystems|signal|thoughtcrime|securesms/i.test(id);
