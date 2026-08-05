## 2024-05-24 - [Semantic HTML for Form Labels]
**Learning:** Using generic `<div>` elements instead of `<label>` for form field headers creates accessibility and UX issues. Screen readers won't properly announce the purpose of the input, and users miss out on the native behavior where clicking a label automatically focuses its associated input.
**Action:** Always use semantic `<label for="...">` linked to the correct input ID for form fields, and ensure `cursor: pointer;` is applied if it's not the default style, to indicate the element's interactivity.
