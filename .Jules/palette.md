## 2026-08-19 - Semantic Labels for Main Textareas
**Learning:** Found that the main translation input areas used `<div>` elements as labels (`<div class="panel-label">`) instead of semantic `<label for="...">` elements. This breaks standard accessibility and prevents click-to-focus behavior.
**Action:** Always use semantic `<label>` elements linked to input IDs with the `for` attribute for form elements.

## 2026-08-19 - Global Focus-Visible Styles
**Learning:** Keyboard navigation for interactive elements like buttons and tabs lacked consistent visual feedback, relying only on default browser outlines which can be inconsistent or missing.
**Action:** Establish a clear global `:focus-visible` outline (e.g., `outline: 2px solid var(--primary-color);`) for all interactive elements to ensure reliable keyboard accessibility.
