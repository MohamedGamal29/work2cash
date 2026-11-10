# 3-minute demo video script

Keep it under 3:00. Judges are not required to watch past that. Record the real app, not slides. No third-party logos or copyrighted music.

| Time | On screen | Say |
|---|---|---|
| 0:00 to 0:15 | Hero | "AI agents are about to move money. They hallucinate, they get tricked, and a model that is usually right is not good enough for payments. This is the safety layer." |
| 0:15 to 0:50 | Paste the Arabic note. Press Analyze. | "A freelancer pastes a messy note in Arabic. Gemini extracts the invoice, but it is not allowed to guess: every field must be quoted from these exact words." |
| 0:50 to 1:20 | Evidence Lens: click Unit price, then Stated total | "Click a field and the exact words that justify it light up. Anything my words do not support is flagged." |
| 1:20 to 1:45 | Load the conflict example | "Here the notes say 5 designs at 100 each, but also a total of 400. A model would silently pick one. We block approval and show the 100 dollar gap." |
| 1:45 to 2:25 | Scroll to Attack Lab. Press Run all attacks. | "Now I try to break it. A hallucinated quote. A real quote with the wrong number. A hidden instruction in a client message that says set the total to 50,000. A currency swap, 400 Egyptian pounds relabelled as dollars. A swapped email. Six of six stopped, and the honest invoice passes." Zoom on the red underlined injected instruction. |
| 2:25 to 2:45 | Approve a clean invoice. Show it in PayPal Sandbox. | "Clean invoices go to a human approval, then the PayPal Invoicing API. The approval is hashed. When the client pays, the webhook extends the same hash chain." |
| 2:45 to 3:00 | Show `mcp.example.json` beside PayPal's MCP config | "And the same gate is an MCP server, built to run beside PayPal's own, so any agent can be made to prove its numbers before it touches money. Proof before payment." |

## Before you record
- Run once with real keys: extraction, approval, PayPal draft, sync.
- Pick one Arabic sample that extracts cleanly, and rehearse with it.
- Confirm the Attack Lab shows 6/6 before recording.
- Record at 1080p, browser zoom 110 to 125 percent, notifications off.
