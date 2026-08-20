## 2024-05-24 - Semantic Labels for Textareas
**Learning:** Generic `div` elements used as labels for form inputs prevent users from clicking the text to focus the associated input field, reducing the clickable area and harming accessibility for screen reader and pointer users.
**Action:** Always replace `.label` divs with proper `<label for="...">` elements that match the ID of their associated input or textarea to ensure valid click-to-focus targets and semantic compliance.
