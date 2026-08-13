## 2024-08-13 - [Labels for Forms]
**Learning:** Proper semantic `<label>` elements linked with the `for` attribute provide immense accessibility benefits for forms. Visual text elements often get styled as labels (like `<div class="panel-label">`) but break the programmatic association for screen readers, and remove native click-to-focus functionality that standard `<label>` provides.
**Action:** Use standard `<label for="...">` instead of styled `<divs>` for any text accompanying forms, inputs, and textareas.
