## 2025-01-20 - Use Semantic Form Labels for Textareas

**Learning:** Using generic `<div>` tags for form labels prevents screen readers from correctly associating labels with input fields and misses out on built-in browser behavior (like click-to-focus on the label directing focus to the linked input).

**Action:** Always use `<label for="inputId">` elements properly linked to the ID of the interactive `<input>` or `<textarea>` element. Update associated CSS with `cursor: pointer` and `width: fit-content` so that the clickable area visually and functionally matches the text.
