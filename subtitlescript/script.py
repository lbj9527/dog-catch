import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False)
    context = browser.new_context()
    page = context.new_page()
    page.goto("https://37ub.w7zvq.net/forum.php")
    page.get_by_role("link", name="满18岁，请点此进入").click()
    page.locator("#ls_username").click()
    page.locator("#ls_username").fill("萨芬不否")
    page.locator("#ls_username").press("Tab")
    page.get_by_role("textbox", name="密码").press("CapsLock")
    page.get_by_role("textbox", name="密码").fill("L")
    page.get_by_role("textbox", name="密码").press("CapsLock")
    page.get_by_role("textbox", name="密码").fill("Lbj95278.xyz")
    page.get_by_role("button", name="登录").click()
    page.locator("#loginquestionid_Lj5Pt").select_option("1")
    page.locator("#loginanswer_Lj5Pt").click()
    page.locator("#loginanswer_Lj5Pt").press("CapsLock")
    page.locator("#loginanswer_Lj5Pt").fill("HRY")
    page.locator("button[name=\"loginsubmit\"]").click()
    page.close()

    # ---------------------
    context.storage_state(path="./session.json")
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)
