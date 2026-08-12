## 2026-08-12 - Semantic HTML Labels for Inputs
**Learning:** Discovered a pattern where standard `<div>` elements were being styled and used as labels for main translation textareas. This missed native accessibility features like screen reader association and click-to-focus functionality.
**Action:** Always verify that input elements (like `<input>` or `<textarea>`) are paired with semantic `<label>` elements using the `for` attribute matching the input's ID. This simple structural change provides significant UX/a11y improvements without altering visuals.
