## 2026-08-02 - Initialize journal
**Learning:** Started journal for Aleman Simultaneo
**Action:** Log critical UX/a11y learnings here

## 2026-08-02 - Semantic Labels and Expandable ARIA States
**Learning:** Found that visual labels styled as divs (`.panel-label`) fail to properly associate with textareas for screen readers. Additionally, dynamically expanded content needs explicit ARIA states to communicate state changes to assistive tech.
**Action:** Use native `<label>` elements with `for` attributes instead of styled `<div>`s for form controls. Always add `aria-expanded` to toggle buttons that control collapsible content.
