## 2026-08-09 - Semantic Labels for Station Panels
**Learning:** The Translation Station initially used visual `<div>` tags with the `panel-label` class to label text areas. This broke screen reader accessibility and prevented click-to-focus behavior.
**Action:** Update all future similar components in this app's design system to use semantic `<label for="...">` elements when paired with `textarea` or `input` elements, preserving the `panel-label` class for styling.
