from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('file:///app/benchmark.html')
    page.wait_for_selector('#results:not(:empty)')
    results = page.locator('#results').inner_text()
    print(results)
    browser.close()
