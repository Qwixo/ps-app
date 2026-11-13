# How Cincee protects client information

Plain-English summary of the Cincee Client Vault (cincee.com/client), the system Cincee uses to
manage client projects. Written so it can be shared with a client who asks how their
Confidential Information is controlled (for example under a mutual NDA, sections 2.2, 2.4, 4.6
and 6.2).

## 1. End-to-end encryption

- Every piece of client information (project details, notes, dates, payments, previews,
  meeting summaries) is encrypted **in the browser, before it leaves the device**, with
  **AES-256-GCM**, the same standard used by banks and governments.
- The encryption keys are derived from a passphrase that only the account holder knows
  (PBKDF2-SHA256 with 600,000 rounds). The passphrase is never sent anywhere.
- The hosting providers (Supabase for the database, Netlify for the website) only ever store and
  serve scrambled data. They cannot read it, and neither could anyone who stole a copy of the
  database. Cincee itself cannot reset a lost passphrase: there is no master key on a server.
- Every record is also bound to its own identity and owner, so the encrypted data cannot be
  swapped or moved between records or clients without the change being detected.

## 2. Each client is sandboxed twice

1. **Access rules in the database.** A client account can only fetch the records of its own
   project space. Requests for anything else return nothing.
2. **A separate encryption key per client.** Each client's space is encrypted with its own
   random key. A client never holds any other client's key, so even if they somehow obtained
   another client's encrypted data, they could not read it.

Clients join only through a private, single-use invite link that expires after 7 days. Nobody
can create an account on their own.

These protections are checked by an automated test suite (46 checks) that signs in as one
client and attempts to read, write, move, delete and decrypt another client's data, the owner's
data, encryption keys, invites and logs. Every attempt is refused.

## 3. Need to know (NDA 2.1)

Only The owner (Cincee) can see across clients. A client sees only their own project page.
Cincee's own assistant tool, running on Owner's computer, can open client project pages so it
can keep them up to date for him. It has its own key, kept in that computer's secure keychain,
every sign-in is logged, and Owner can switch it off in one click. It can never open Cincee's
own private notes and records.
Client names are never shown to other clients. The database and website providers see only
encrypted data and pseudonymous account ids (never names or email addresses).

## 4. Breach awareness (NDA 2.4)

Every sign-in is recorded in a log that only Cincee can see (time and device). Any sign-in that
is not Cincee or a known client is flagged, so a problem can be spotted and reported promptly.

## 5. Certification and audit (NDA 4.6)

On request Cincee can provide this summary, the sign-in log for the client's space, and a
walkthrough of the controls above.

## 6. Return or destruction (NDA 6.2)

- **Return:** Cincee can export everything held about a client in one file.
- **Destruction:** Cincee can permanently destroy a client's space. This deletes the client's
  records and their encryption key. Because the key is gone, any copy of the encrypted data
  (including provider backups) becomes permanently unreadable. Cincee can confirm this in
  writing.

## 7. Other safeguards

- The website sends strict security headers (no third-party scripts, no framing, no tracking,
  HTTPS only) and is hidden from search engines.
- The app locks itself after a period of inactivity and keys are held only in memory while
  unlocked.
- Copies kept on Cincee's own devices for offline use are encrypted too.
- No email or message is ever sent automatically. Every client email is drafted and approved
  word for word by Cincee before it is sent by hand.
