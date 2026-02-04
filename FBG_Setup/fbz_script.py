import sys
import random
import string
import os
import glob
import shutil
import re
import pyotp
from PyQt5.QtWidgets import QApplication, QWidget, QLabel, QLineEdit, QPushButton, QVBoxLayout, QHBoxLayout, QSpinBox, QTextEdit, QMessageBox, QFileDialog, QComboBox, QGroupBox, QGridLayout
from PyQt5.QtCore import QThread, pyqtSignal
from selenium.webdriver.common.action_chains import ActionChains
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException
import time
import logging

ELEMENT_DELAY = 8
LONG_DELAY = 25

# Modern dark UI styling
APP_QSS = """
QWidget {
  background: #0f1115;
  color: #e6edf3;
  font-family: Segoe UI, Inter, Arial;
  font-size: 12.5pt;
}
QGroupBox {
  border: 1px solid #1f2633;
  border-radius: 8px;
  margin-top: 12px;
  padding: 10px 12px 12px 12px;
}
QGroupBox::title {
  subcontrol-origin: margin;
  left: 10px;
  padding: 0 6px;
  color: #a0b3c6;
  font-weight: 600;
}
QLabel { color: #cbd5e1; }
QLineEdit, QTextEdit, QSpinBox, QComboBox {
  background: #0b0d11;
  border: 1px solid #222a3b;
  border-radius: 6px;
  padding: 8px;
  selection-background-color: #2563eb;
}
QLineEdit:focus, QTextEdit:focus, QSpinBox:focus, QComboBox:focus {
  border: 1px solid #2563eb;
}
QPushButton {
  background: #1e293b;
  border: 1px solid #2f394a;
  color: #e6edf3;
  border-radius: 8px;
  padding: 8px 14px;
}
QPushButton:hover {
  background: #263445;
}
QPushButton#primary {
  background: #2563eb;
  border: 1px solid #1e4fd0;
}
QPushButton#primary:hover { background: #1f54c9; }
QTextEdit { min-height: 220px; }
"""

def advanced_log(driver, msg):
    print(msg)
    # Optionally, use driver.save_screenshot() to debug UI states

class FirebaseWorker(QThread):
    log_signal = pyqtSignal(str)
    done_signal = pyqtSignal(str)

    def __init__(self, email, password, org_id, otp_secret, thread_id):
        super().__init__()
        self.email = email
        self.password = password
        self.org_id = org_id
        self.otp_secret = otp_secret
        self.thread_id = thread_id

    def log(self, message):
        self.log_signal.emit(f"[Thread {self.thread_id}] {message}")

    def generate_project_name(self):
        base = ''.join(c for c in self.email.split('@')[0] if c.isalnum())
        return f"{base[:10].lower()}p{random.randint(100,999)}"

    def generate_otp(self):
        if self.otp_secret:
            totp = pyotp.TOTP(self.otp_secret)
            return totp.now()
        return ""

    def run(self):
        driver = None
        try:
            options = webdriver.ChromeOptions()
            driver = webdriver.Chrome(options=options)
            driver.set_window_size(1280, 900)
            self.log("Logging into Google...")
            self.login_to_google(driver)
            project_name = self.generate_project_name()
            self.log("Login successful. Creating Firebase project: " + project_name)
            self.create_firebase_project(driver, project_name)
            self.done_signal.emit(f"✅ Project created: {project_name}")
        except Exception as e:
            self.log(f"❌ Error: {str(e)}")
        finally:
            if driver:
                driver.quit()

    def login_to_google(self, driver):
        driver.get("https://accounts.google.com/signin/v2/identifier")
        WebDriverWait(driver, LONG_DELAY).until(
            EC.element_to_be_clickable((By.ID, "identifierId"))
        ).send_keys(self.email + Keys.ENTER)
        WebDriverWait(driver, LONG_DELAY).until(
            EC.element_to_be_clickable((By.NAME, "Passwd"))
        ).send_keys(self.password + Keys.ENTER)
        time.sleep(4)

        # Handle OTP if provided
        if self.otp_secret:
            try:
                otp_input = WebDriverWait(driver, ELEMENT_DELAY).until(
                    EC.presence_of_element_located((By.NAME, "totpPin"))
                )
                otp_code = self.generate_otp()
                otp_input.send_keys(otp_code)
                otp_input.send_keys(Keys.ENTER)
                self.log("Entered OTP code.")
                time.sleep(3)
            except TimeoutException:
                self.log("OTP not shown. Skipping.")

        # Always handle potential interstitials after login
        self.handle_speedbump_page(driver)
        self.handle_twosvrequired_page(driver)
            

    def handle_speedbump_page(self, driver):
        """
        Handles the Google 'speedbump/gaplustos' consent/alert page after login, in any language.
        """
        try:
            # Wait until the URL is the speedbump page
            WebDriverWait(driver, 5).until(
                EC.url_contains("https://accounts.google.com/speedbump/gaplustos")
            )
            self.log("Speedbump page detected, attempting to click consent button...")
            # Try multiple known button texts for various languages
            btn_texts = [
                "J'ai compris", "I understand", "I accept", "J’accepte", "J'accepte",
                "Accept", "OK", "Oui", "D'accord"
            ]
            clicked = False
            for btn_text in btn_texts:
                try:
                    btn = driver.find_element(By.XPATH, f"//button[normalize-space(text())='{btn_text}']")
                    driver.execute_script("arguments[0].click();", btn)
                    self.log(f"Clicked '{btn_text}' button on speedbump page.")
                    clicked = True
                    break
                except Exception:
                    continue
            if not clicked:
                # Try a generic confirm button as fallback
                try:
                    driver.find_element(By.ID, "confirm").click()
                    self.log("Clicked generic #confirm button on speedbump page.")
                    clicked = True
                except Exception:
                    pass
            # Wait for the URL to change (leave speedbump)
            WebDriverWait(driver, 8).until(lambda d: "gaplustos" not in d.current_url)
        except TimeoutException:
            self.log("No speedbump encountered after login. Continuing...")
        except Exception as e:
            self.log(f"Error handling speedbump page: {e}")
    
    def handle_twosvrequired_page(self, driver):
        """
        Handles the Google 'Two-step verification required' page.
        """
        try:
            WebDriverWait(driver, 5).until(
                EC.url_contains("https://myaccount.google.com/interstitials/twosvrequired")
            )
            self.log("Two-step verification required page detected, clicking enroll link...")
            # Try to find and click the enrollment link
            link = driver.find_element(By.XPATH, "//a[contains(@href, '/signinoptions/two-step-verification/enroll')]")
            driver.execute_script("arguments[0].click();", link)
            time.sleep(2)
        except TimeoutException:
            self.log("No two-step verification required page encountered. Continuing...")
        except Exception as e:
            self.log(f"Error handling 2SV required page: {e}")
            
    def create_firebase_project(self, driver, project_name):
        driver.get("https://console.firebase.google.com/")
    
        # Step 1: Click "Add project" or "Get started"
        try:
            start_btn = WebDriverWait(driver, LONG_DELAY).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(@data-test-id,'create-project-button')]"))
            )
            start_btn.click()
            self.log("Clicked 'Add project'")
            time.sleep(2)
        except TimeoutException:
            self.log("Start/Create Project button not found; trying card click...")
            try:
                fire_card = WebDriverWait(driver, ELEMENT_DELAY).until(
                    EC.element_to_be_clickable((By.XPATH, '//fire-card-body[@jslog="175527;track:generic_click"]'))
                )
                fire_card.click()
                self.log("Clicked get started card.")
                time.sleep(2)
            except Exception as e:
                self.log("Can't find any create project option.")
                raise e
    
        # Step 2: Enter Project Name and wait for button enabled
        name_input = WebDriverWait(driver, LONG_DELAY).until(
            EC.element_to_be_clickable((By.ID, "projectName"))
        )
        name_input.clear()
        name_input.send_keys(project_name)
        self.log(f"Project name set: {project_name}")
        time.sleep(1.5)

        # Try to click the primary Continue button after entering project name
        try:
            cont_after_name = WebDriverWait(driver, 4).until(
                EC.element_to_be_clickable((By.XPATH, "/html/body/div[4]/div[3]/div/fire-full-screen-modal/mat-sidenav-container/mat-sidenav/div/c5e-create-project-dialog/fire-full-screen-modal-container/fire-full-screen-modal-content/firebase-project-page/create-project-content/div/form/div[4]/button"))
            )
            cont_after_name.click()
            self.log("Clicked Continue after entering project name.")
            time.sleep(1)
        except Exception:
            self.log("Continue button after project name not present; proceeding with parent resource handling if needed.")

        # If the cloud resource selector dialog is shown, confirm or pick first option then confirm
        try:
            WebDriverWait(driver, 3).until(
                EC.presence_of_element_located((By.XPATH, "/html/body/div[4]/div[6]/div/mat-dialog-container"))
            )
            self.log("Parent resource selector dialog detected.")
            try:
                ok_btn = driver.find_element(By.XPATH, "/html/body/div[4]/div[6]/div/mat-dialog-container/div/div/ng-component/fire-cloud-resource-selector-dialog/fire-dialog/fire-dialog-actions/button[2]")
                if ok_btn.is_enabled():
                    ok_btn.click()
                    self.log("OK button enabled; confirmed parent resource.")
                else:
                    # Select first node from the second tree selector then confirm
                    first_node_2 = WebDriverWait(driver, 6).until(
                        EC.element_to_be_clickable((By.XPATH, "/html/body/div[4]/div[6]/div/mat-dialog-container/div/div/ng-component/fire-cloud-resource-selector-dialog/fire-dialog/fire-dialog-body/fire-dialog-body-content/cloud-resource-tree-selector[2]/cdk-tree/cdk-tree-node"))
                    )
                    first_node_2.click()
                    self.log("Selected first option in second resource tree.")
                    WebDriverWait(driver, 6).until(lambda d: d.find_element(By.XPATH, "/html/body/div[4]/div[6]/div/mat-dialog-container/div/div/ng-component/fire-cloud-resource-selector-dialog/fire-dialog/fire-dialog-actions/button[2]").is_enabled())
                    driver.find_element(By.XPATH, "/html/body/div[4]/div[6]/div/mat-dialog-container/div/div/ng-component/fire-cloud-resource-selector-dialog/fire-dialog/fire-dialog-actions/button[2]").click()
                    self.log("Confirmed parent resource with OK after selection.")
            except Exception:
                # If OK button not found or not enabled, try general-first-node then OK
                try:
                    first_node_any = WebDriverWait(driver, 6).until(
                        EC.element_to_be_clickable((By.XPATH, "/html/body/div[4]/div[6]/div/mat-dialog-container/div/div/ng-component/fire-cloud-resource-selector-dialog/fire-dialog/fire-dialog-body/fire-dialog-body-content/cloud-resource-tree-selector/cdk-tree/cdk-tree-node"))
                    )
                    first_node_any.click()
                    self.log("Selected first option in resource tree (generic).")
                    ok_btn2 = WebDriverWait(driver, 6).until(
                        EC.element_to_be_clickable((By.XPATH, "/html/body/div[4]/div[6]/div/mat-dialog-container/div/div/ng-component/fire-cloud-resource-selector-dialog/fire-dialog/fire-dialog-actions/button[2]"))
                    )
                    ok_btn2.click()
                    self.log("Confirmed parent resource with OK (generic).")
                except Exception:
                    self.log("Could not interact with resource selector dialog; continuing.")
        except Exception:
            # Dialog not shown; continue normal flow
            pass
        
        try:
            parent_chip = driver.find_element(By.XPATH, "/html/body/div[4]/div[3]/div/fire-full-screen-modal/mat-sidenav-container/mat-sidenav/div/c5e-create-project-dialog/fire-full-screen-modal-container/fire-full-screen-modal-content/firebase-project-page/create-project-content/div/form/div[2]/fire-cloud-resource-chip/button")
            parent_chip.click()
            self.log("Clicked parent resource chip.")
            time.sleep(1)
        
            org_xpath = "//cdk-tree-node//span[contains(text(), 'oneofitsmostimportant.ddnsguru.com')]"
            org_node = WebDriverWait(driver, 8).until(
                EC.visibility_of_element_located((By.XPATH, org_xpath))
            )
        
            done_xpath = "//button[./span[contains(text(), 'Done')] or ./span[contains(text(), 'Fertig')]]"
            done_btn = WebDriverWait(driver, 8).until(
                EC.presence_of_element_located((By.XPATH, done_xpath))
            )
        
            if done_btn.is_enabled():
                self.log("Done button is enabled, org already selected.")
                done_btn.click()
                self.log("Clicked Done.")
            else:
                self.log("Done button is disabled, selecting org node now.")
                org_node.click()
                # Wait for the Done button to become enabled
                WebDriverWait(driver, 5).until(lambda d: d.find_element(By.XPATH, done_xpath).is_enabled())
                done_btn = driver.find_element(By.XPATH, done_xpath)  # Re-grab after enabled
                done_btn.click()
                self.log("Selected org and clicked Done.")
        
        except Exception as e:
            self.log(f"❌ Error (org selection logic): {str(e)}")
        
        
        
        
            # Fallback: select first resource in the dialog and confirm (dialog appears only sometimes)
            try:
                # Try the second tree first as requested
                try:
                    first_node = WebDriverWait(driver, 6).until(
                        EC.element_to_be_clickable((By.XPATH, "/html/body/div[4]/div[6]/div/mat-dialog-container/div/div/ng-component/fire-cloud-resource-selector-dialog/fire-dialog/fire-dialog-body/fire-dialog-body-content/cloud-resource-tree-selector[2]/cdk-tree/cdk-tree-node"))
                    )
                except Exception:
                    first_node = WebDriverWait(driver, 6).until(
                        EC.element_to_be_clickable((By.XPATH, "/html/body/div[4]/div[6]/div/mat-dialog-container/div/div/ng-component/fire-cloud-resource-selector-dialog/fire-dialog/fire-dialog-body/fire-dialog-body-content/cloud-resource-tree-selector/cdk-tree/cdk-tree-node"))
                    )
                first_node.click()
                self.log("Selected first parent resource from dialog.")
                ok_btn = WebDriverWait(driver, 10).until(
                    EC.element_to_be_clickable((By.XPATH, "/html/body/div[4]/div[6]/div/mat-dialog-container/div/div/ng-component/fire-cloud-resource-selector-dialog/fire-dialog/fire-dialog-actions/button[2]"))
                )
                ok_btn.click()
                self.log("Confirmed parent resource selection with OK.")
                time.sleep(1)
            except Exception:
                # Dialog may not appear; continue the flow
                self.log("Resource selector dialog not present or could not be handled; continuing.")
        except Exception:
            self.log("Parent resource selection not required or already handled.")
        
        # First-time TOS checkbox (if present)
        try:
            tos_chk = driver.find_element(By.XPATH, "/html/body/div[4]/div[3]/div/fire-full-screen-modal/mat-sidenav-container/mat-sidenav/div/c5e-create-project-dialog/fire-full-screen-modal-container/fire-full-screen-modal-content/firebase-project-page/create-project-content/div/form/div[3]/firebase-tos/div/mat-checkbox/div/div/input")
            if not tos_chk.is_selected():
                tos_chk.click()
            self.log("Accepted TOS checkbox (first-time flow).")
            time.sleep(1)
        except Exception:
            self.log("TOS checkbox not shown (already accepted or not required).")
        
        # Continue after TOS (if present)
        try:
            cont_btn = WebDriverWait(driver, ELEMENT_DELAY).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(@type,'submit') and not(@disabled)]"))
            )
            cont_btn.click()
            self.log("Submitted after TOS.")
            time.sleep(1.5)
        except Exception:
            self.log("No continue button after TOS or already handled.")
        
    
        # Step 3: Organization Selection (if shown)
        try:
            org_node = WebDriverWait(driver, ELEMENT_DELAY).until(
                EC.presence_of_element_located((By.XPATH, f'//cdk-tree-node[@data-resource-name=\"organizations/{self.org_id}\"]'))
            )
            org_node.click()
            self.log("Organization selected.")
            time.sleep(1)
            cont_btn = WebDriverWait(driver, ELEMENT_DELAY).until(
                EC.element_to_be_clickable((By.XPATH, "//button[contains(@type,'submit') and not(@disabled)]"))
            )
            cont_btn.click()
            self.log("Submitted org selection.")
        except Exception:
            self.log("No org selection or already chosen.")
    
        # Step 4: Accept Google Terms (if checkbox shown, not first-time)
        try:
            terms_chk = WebDriverWait(driver, ELEMENT_DELAY).until(
                EC.presence_of_element_located((By.XPATH, "//input[@type='checkbox']"))
            )
            if not terms_chk.is_selected():
                terms_chk.click()
            self.log("Accepted Google Terms.")
        except Exception:
            self.log("Terms checkbox not found. Continuing.")
    
        # Step 5: Continue/submit buttons loop (pre-analytics)
        for i in range(4):
            try:
                btn = WebDriverWait(driver, ELEMENT_DELAY).until(
                    EC.element_to_be_clickable((By.XPATH, "//button[(contains(@type,'submit') or contains(@class,'continue') or contains(@class,'submit-button')) and not(@disabled)]"))
                )
                btn.click()
                self.log("Clicked continue/submit.")
                time.sleep(2)
            except Exception:
                self.log("No more continue/submit buttons in loop; likely finished.")
                break
    
        # Step 6: Analytics handling (all scenarios)
        analytics_handled = False
        try:
            analytics_btn = WebDriverWait(driver, 10).until(
                EC.element_to_be_clickable((By.XPATH, "/html/body/div[4]/div[3]/div/fire-full-screen-modal/mat-sidenav-container/mat-sidenav/div/c5e-create-project-dialog/fire-full-screen-modal-container/fire-full-screen-modal-content/analytics-details-page/create-project-content/div/form/div/div[1]/analytics-account-selector/div/button"))
            )
            analytics_btn.click()
            self.log("Analytics selector opened (account present).")
            time.sleep(2)
            actions = ActionChains(driver)
            actions.send_keys(Keys.ARROW_UP).perform()
            time.sleep(0.5)
            actions.send_keys(Keys.ARROW_UP).perform()
            time.sleep(0.5)
            actions.send_keys(Keys.ENTER).perform()
            self.log("Selected analytics account (2x UP, ENTER).")
            time.sleep(1.2)
            analytics_handled = True
        except Exception:
            self.log("Analytics account selector not present or not required.")
    
        if analytics_handled:
            # Continue as usual (press create button for analytics scenario)
            try:
                create_btn = WebDriverWait(driver, 16).until(
                    EC.element_to_be_clickable((By.XPATH, "/html/body/div[4]/div[3]/div/fire-full-screen-modal/mat-sidenav-container/mat-sidenav/div/c5e-create-project-dialog/fire-full-screen-modal-container/fire-full-screen-modal-content/analytics-details-page/create-project-content/div/form/div/div[4]/button[2]"))
                )
                create_btn.click()
                self.log("Clicked 'Create project' (analytics account chosen). Waiting for creation...")
            except Exception as e:
                self.log("Create project button (analytics account) not found: " + str(e))
        else:
            # Analytics not available: check 'no analytics' and create
            try:
                no_analytics_chk = driver.find_element(By.XPATH, "/html/body/div[4]/div[3]/div/fire-full-screen-modal/mat-sidenav-container/mat-sidenav/div/c5e-create-project-dialog/fire-full-screen-modal-container/fire-full-screen-modal-content/analytics-details-page/create-project-content/div/form/div/div[1]/mat-checkbox/div/div/input")
                if not no_analytics_chk.is_selected():
                    no_analytics_chk.click()
                self.log("Checked 'no analytics' checkbox.")
                time.sleep(1)
                create_btn = WebDriverWait(driver, 16).until(
                    EC.element_to_be_clickable((By.XPATH, "/html/body/div[4]/div[3]/div/fire-full-screen-modal/mat-sidenav-container/mat-sidenav/div/c5e-create-project-dialog/fire-full-screen-modal-container/fire-full-screen-modal-content/analytics-details-page/create-project-content/div/form/div/div[3]/button[2]"))
                )
                create_btn.click()
                self.log("Clicked 'Create project' (no analytics). Waiting for creation...")
            except Exception as e:
                self.log("No analytics scenario failed or not required: " + str(e))
    
        # Step 7: Wait for project creation to finish and press final 'Continue'
        try:
            continue_btn = WebDriverWait(driver, 180).until(
                EC.element_to_be_clickable((By.XPATH, "/html/body/div[4]/div[3]/div/fire-full-screen-modal/mat-sidenav-container/mat-sidenav/div/c5e-create-project-dialog/fire-full-screen-modal-container/fire-full-screen-modal-content/submit-page/create-project-content/div/div/button"))
            )
            self.log("Project created! Final 'Continue' button appeared.")
            continue_btn.click()
            self.log("Pressed final 'Continue' button.")
        except Exception as e:
            self.log("Final 'Continue' button not found after creation (waited 3 minutes): " + str(e))
    
        # Step 8: Go to Overview and Wait
        try:
            driver.get(f"https://console.firebase.google.com/project/{project_name}/overview")
            self.log(f"Project dashboard opened for {project_name}.")
            time.sleep(5)
        except Exception as e:
            self.log("Error loading project dashboard: " + str(e))
    
        # Step 9: Go to Authentication page and enable Email/Password
        try:
            driver.get(f"https://console.firebase.google.com/project/{project_name}/authentication")
            self.log("Navigated to Authentication section.")
    
            # Click 'Get started'/'Commencer'
            get_started_btn = WebDriverWait(driver, 30).until(
                EC.element_to_be_clickable((By.XPATH, "/html/body/fireconsole-app-root/fireconsole-home/main/fire-router-outlet/route-state/authentication-index/ng-component/authentication-zero-state/fire-zerostate-header/div/div[2]/div/div/div/fire-zsh-custom-cta/button"))
            )
            get_started_btn.click()
            self.log("Clicked 'Get started' button for authentication.")
    
            # Wait for redirect
            WebDriverWait(driver, 20).until(
                EC.url_contains(f"/project/{project_name}/authentication/providers")
            )
            self.log("Arrived at authentication providers.")
    
            # Click Email/Password method tile
            email_pw_tile = WebDriverWait(driver, 20).until(
                EC.element_to_be_clickable((By.XPATH, "/html/body/fireconsole-app-root/fireconsole-home/main/fire-router-outlet/route-state/authentication-index/ng-component/authentication-providers/div/div[2]/authentication-providers-zero-state-card/mat-card/authentication-provider-creation-panel/div/div[1]/div[2]/div[1]/div[2]/ul/li[1]/authentication-provider-tile/div"))
            )
            email_pw_tile.click()
            self.log("Selected 'Email/Password' provider.")
            time.sleep(1.2)
    
            # Click the toggle to enable
            toggle_btn = WebDriverWait(driver, 20).until(
                EC.element_to_be_clickable((By.XPATH, "/html/body/fireconsole-app-root/fireconsole-home/main/fire-router-outlet/route-state/authentication-index/ng-component/authentication-providers/div/div[2]/authentication-providers-zero-state-card/mat-card/authentication-provider-creation-panel/div/div[2]/div/authentication-identity-provider-password/authentication-identity-provider-frame/div[2]/div[1]/form/mat-slide-toggle/div/button"))
            )
            toggle_btn.click()
            self.log("Enabled the Email/Password toggle.")
            time.sleep(1)
    
            # Now Save
            save_btn = WebDriverWait(driver, 20).until(
                EC.element_to_be_clickable((By.XPATH, "/html/body/fireconsole-app-root/fireconsole-home/main/fire-router-outlet/route-state/authentication-index/ng-component/authentication-providers/div/div[2]/authentication-providers-zero-state-card/mat-card/authentication-provider-creation-panel/div/div[2]/div/authentication-identity-provider-password/authentication-identity-provider-frame/div[2]/div[2]/button[2]"))
            )
            save_btn.click()
            self.log("Saved Email/Password authentication provider.")
            time.sleep(2)
        except Exception as e:
            self.log("Could not enable Email/Password provider: " + str(e))
    
    
        # Step 10: Register a new Web App, extract apiKey, download service account key
        try:
            driver.get(f"https://console.firebase.google.com/project/{project_name}/overview")
            self.log("Navigated to Project Overview.")
            time.sleep(5)
        
            # Open the "Register App" (Web) dialog
            add_app_btn = WebDriverWait(driver, 30).until(
                EC.element_to_be_clickable((By.XPATH, "/html/body/fireconsole-app-root/fireconsole-home/main/fire-router-outlet/route-state/p9e-page/fire-feature-bar/div/div[2]/div[5]/p9e-app-bar/div[2]/div[2]/button[3]"))
            )
            add_app_btn.click()
            self.log("Clicked to register new app.")
            time.sleep(1.5)

            # Ensure the Web platform is selected so the onboarding dialog opens
            try:
                # If the onboarding dialog isn't open yet, click 'Web' in the platform menu
                dialog_present = lambda d: len(d.find_elements(By.XPATH, "//c5e-app-onboarding-dialog")) > 0
                if not dialog_present(driver):
                    web_option_xpaths = [
                        "//mat-menu//button[contains(@data-test-id,'add-web-app')]",
                        "//mat-menu//button[contains(@data-test-id,'add-web-app-button')]",
                        "//div[contains(@class,'mat-menu-panel')]//button[.//span[contains(.,'Web')]]",
                        "//button[contains(@aria-label,'Web') and contains(@class,'mat-menu-item')]",
                        "//button[.//span[contains(.,'Web')]]"
                    ]
                    clicked_web = False
                    for xp in web_option_xpaths:
                        try:
                            web_btn = WebDriverWait(driver, 5).until(
                                EC.element_to_be_clickable((By.XPATH, xp))
                            )
                            web_btn.click()
                            clicked_web = True
                            break
                        except Exception:
                            continue
                    if clicked_web:
                        self.log("Selected 'Web' platform from the add app menu.")
                # Wait for the onboarding dialog to appear
                WebDriverWait(driver, 20).until(
                    EC.presence_of_element_located((By.XPATH, "//c5e-app-onboarding-dialog"))
                )
                self.log("Web app registration dialog opened.")
            except Exception as e:
                self.log(f"Web app registration dialog may already be open or menu not shown: {e}")
        
            # Generate new app name
            base = ''.join(c for c in self.email.split('@')[0] if c.isalnum())
            app_name = f"{base[:8].lower()}app{random.randint(100,999)}"
        
            # Enter app name (robust locator with fallbacks)
            app_name_input = None
            app_name_xpaths = [
                # User-provided exact modal index (can vary by session)
                "/html/body/div[4]/div[49]/div/fire-full-screen-modal/mat-sidenav-container/mat-sidenav/div/c5e-app-onboarding-dialog/div[2]/div/c5e-app-onboarding-form/fire-stepper/mat-stepper/div[1]/div/div/div/fire-step-content/c5e-app-onboarding-form-details/div/form/div/div[1]/c5e-app-onboarding-details-app-nickname/fire-input-container/input",
                # Previously observed modal index
                "/html/body/div[4]/div[39]/div/fire-full-screen-modal/mat-sidenav-container/mat-sidenav/div/c5e-app-onboarding-dialog/div[2]/div/c5e-app-onboarding-form/fire-stepper/mat-stepper/div[1]/div/div/div/fire-step-content/c5e-app-onboarding-form-details/div/form/div/div[1]/c5e-app-onboarding-details-app-nickname/fire-input-container/input",
                # Modal-agnostic fallbacks (prefer structure over numeric indices)
                "//fire-full-screen-modal//c5e-app-onboarding-form//c5e-app-onboarding-form-details//c5e-app-onboarding-details-app-nickname//input",
                "//c5e-app-onboarding-details-app-nickname//input",
                "//fire-step-content//c5e-app-onboarding-form-details//input"
            ]
            for xp in app_name_xpaths:
                try:
                    elem = WebDriverWait(driver, 10).until(
                        EC.element_to_be_clickable((By.XPATH, xp))
                    )
                    app_name_input = elem
                    break
                except Exception:
                    continue

            if app_name_input is None:
                raise TimeoutException("Web App name input field not found with known locators")

            try:
                driver.execute_script("arguments[0].scrollIntoView({block: 'center'});", app_name_input)
            except Exception:
                pass

            app_name_input.clear()
            app_name_input.send_keys(app_name)
            self.log(f"Typed new app name: {app_name}")
            time.sleep(0.5)

            # Optional: select checkbox in the web app registration dialog if present
            try:
                checkbox_xpaths = [
                    "//fire-full-screen-modal//c5e-app-onboarding-form//c5e-app-onboarding-form-details//mat-checkbox//input",
                    "//c5e-app-onboarding-form-details//mat-checkbox//input",
                    "//fire-step-content//mat-checkbox//input[@type='checkbox']"
                ]
                checkbox_el = None
                for cxp in checkbox_xpaths:
                    try:
                        checkbox_el = WebDriverWait(driver, 4).until(
                            EC.presence_of_element_located((By.XPATH, cxp))
                        )
                        break
                    except Exception:
                        continue
                if checkbox_el is not None and not checkbox_el.is_selected():
                    driver.execute_script("arguments[0].click();", checkbox_el)
                    self.log("Checked optional checkbox in web app dialog.")
                    time.sleep(0.3)
            except Exception:
                self.log("No selectable checkbox in web app dialog or already checked.")
            self.log(f"Typed new app name: {app_name}")
            time.sleep(1)
        
            # Click Register App (robust with fallbacks)
            register_xpaths = [
                "/html/body/div[4]/div[49]/div/fire-full-screen-modal/mat-sidenav-container/mat-sidenav/div/c5e-app-onboarding-dialog/div[2]/div/c5e-app-onboarding-form/fire-stepper/mat-stepper/div[1]/div/div/div/fire-step-content/c5e-app-onboarding-form-details/div/form/div/div[2]/button",
                "/html/body/div[4]/div[39]/div/fire-full-screen-modal/mat-sidenav-container/mat-sidenav/div/c5e-app-onboarding-dialog/div[2]/div/c5e-app-onboarding-form/fire-stepper/mat-stepper/div[1]/div/div/div/fire-step-content/c5e-app-onboarding-form-details/div/form/div/div[2]/button",
                "//fire-full-screen-modal//c5e-app-onboarding-form//c5e-app-onboarding-form-details//button[.//span[contains(.,'Register') or contains(.,'Inscrire') or contains(.,'Registrer') or contains(.,'Enregistrer')] or contains(@data-test-id,'register-app')]",
                "//c5e-app-onboarding-form-details//button[contains(@class,'mat-button') or contains(@class,'mat-raised-button')]"
            ]
            register_btn = None
            for xp in register_xpaths:
                try:
                    register_btn = WebDriverWait(driver, 8).until(
                        EC.element_to_be_clickable((By.XPATH, xp))
                    )
                    break
                except Exception:
                    continue
            if register_btn is None:
                raise TimeoutException("Register app button not found with known locators")
            register_btn.click()
            self.log("Clicked 'Register app' button.")
            
            # --- Wait for the API key code block to appear (max 25 seconds) ---
            api_key_block_appeared = False
            try:
                WebDriverWait(driver, 25).until(
                    EC.visibility_of_element_located((By.CSS_SELECTOR, "#cdk-stepper-0-content-1 fire-code-block"))
                )
                api_key_block_appeared = True
                self.log("fire-code-block with SDK appeared.")
            except Exception:
                self.log("fire-code-block did NOT appear in time. Extraction will probably fail.")
            
           
        
            # --- Private Key Download and Move ---
            try:
                driver.get(f"https://console.firebase.google.com/project/{project_name}/settings/serviceaccounts/adminsdk")
                self.log("Navigated to Service Accounts.")
        
                # Click "Generate New Private Key" button
                download_btn = WebDriverWait(driver, 30).until(
                    EC.element_to_be_clickable((By.XPATH, "/html/body/fireconsole-app-root/fireconsole-home/main/fire-router-outlet/route-state/ng-component/service-accounts-settings/div/fire-card/mat-card/fire-major-minor-card/div/div[2]/div/service-accounts-adminsdk/section[2]/button"))
                )
                download_btn.click()
                self.log("Clicked 'Generate new private key' button.")
                time.sleep(2)
        
                # Confirm in popup
                genkey_btn = WebDriverWait(driver, 15).until(
                    EC.element_to_be_clickable((By.XPATH, "/html/body/div[4]/div[41]/div/mat-dialog-container/div/div/fire-generate-key-dialog/fire-dialog/fire-dialog-actions/button[2]"))
                )
                genkey_btn.click()
                self.log("Confirmed key generation (download should start).")
                time.sleep(5)
        
                # Move the latest .json download to the right directory and name
                download_dir = os.path.join(os.path.expanduser("~"), "Downloads")
                files = sorted(glob.glob(os.path.join(download_dir, "*.json")), key=os.path.getmtime, reverse=True)
                if not files:
                    self.log("No downloaded JSON key file found!")
                else:
                    safe_email = self.email.replace("@", "_at_").replace(".", "_dot_")
                    os.makedirs("private_keys", exist_ok=True)
                    dest = os.path.join("private_keys", f"{safe_email}.json")
                    shutil.move(files[0], dest)
                    self.log(f"Private key saved as: {dest}")
            except Exception as e:
                self.log("Error during private key download/save: " + str(e))
        
        except Exception as e:
            self.log("Error during Web App registration or subsequent steps: " + str(e))
        
        # Step 11: This should ALWAYS run, even if Step 10 did not raise an exception
        try:
            driver.get(f"https://console.firebase.google.com/project/{project_name}/settings/general/")
            self.log("Navigated to project settings > general.")
        
            codeblock_xpath = "/html/body/fireconsole-app-root/fireconsole-home/main/fire-router-outlet/route-state/settings-general-page/div[4]/fire-card/mat-card/fire-major-minor-card/div/div[2]/div/div/console-web-summary/div/sdk-snippet/div/fire-code-block[2]"
            sdk_block = WebDriverWait(driver, 25).until(
                EC.visibility_of_element_located((By.XPATH, codeblock_xpath))
            )
        
            code_text = sdk_block.text
            match = re.search(r'apiKey\s*:\s*"([^"]+)"', code_text)
            if match:
                api_key = match.group(1)
                self.log(f"Extracted API key from settings/general: {api_key}")
                with open("apikeys.txt", "a", encoding="utf-8") as f:
                    f.write(f"{self.email}:{api_key}\n")
                self.log("Saved apiKey to apikeys.txt.")
            else:
                self.log("apiKey not found in SDK snippet on settings/general!")
        except Exception as e:
            self.log(f"Error extracting/saving apiKey from settings/general: {str(e)}")
                                            

class FirebaseCreatorUI(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Firebase Project Creator – Single/Bulk")
        self.setFixedSize(760, 700)
        self.threads = []
        self.pending_accounts = []
        self.active_workers = []
        self.init_ui()

    def init_ui(self):
        layout = QVBoxLayout()

        # Mode group
        mode_group = QGroupBox("Run Mode")
        mode_grid = QGridLayout()
        self.mode_label = QLabel("Mode")
        self.mode_select = QComboBox()
        self.mode_select.addItems(["Single (typing)", "Bulk (CSV file)"])
        self.mode_select.currentIndexChanged.connect(self.toggle_mode)
        mode_grid.addWidget(self.mode_label, 0, 0)
        mode_grid.addWidget(self.mode_select, 0, 1)
        mode_group.setLayout(mode_grid)
        layout.addWidget(mode_group)

        # Single inputs group
        single_group = QGroupBox("Single Account")
        single_grid = QGridLayout()
        self.email_label = QLabel("Google Email:")
        self.email_input = QLineEdit()
        self.password_label = QLabel("Password:")
        self.password_input = QLineEdit()
        self.password_input.setEchoMode(QLineEdit.Password)
        self.otp_label = QLabel("OTP Secret Key (optional):")
        self.otp_input = QLineEdit()
        single_grid.addWidget(self.email_label, 0, 0)
        single_grid.addWidget(self.email_input, 0, 1)
        single_grid.addWidget(self.password_label, 1, 0)
        single_grid.addWidget(self.password_input, 1, 1)
        single_grid.addWidget(self.otp_label, 2, 0)
        single_grid.addWidget(self.otp_input, 2, 1)
        single_group.setLayout(single_grid)
        layout.addWidget(single_group)
        self.single_group = single_group

        # Bulk inputs group
        bulk_group = QGroupBox("Bulk Accounts (CSV)")
        bulk_grid = QGridLayout()
        self.file_label = QLabel("CSV file")
        self.file_input = QLineEdit()
        self.file_browse = QPushButton("Browse…")
        self.file_browse.clicked.connect(self.browse_file)
        bulk_grid.addWidget(self.file_label, 0, 0)
        bulk_grid.addWidget(self.file_input, 0, 1)
        bulk_grid.addWidget(self.file_browse, 0, 2)
        bulk_group.setLayout(bulk_grid)
        layout.addWidget(bulk_group)
        self.bulk_group = bulk_group
        self.bulk_group.hide()

        # Configuration group
        config_group = QGroupBox("Configuration")
        config_grid = QGridLayout()
        self.org_label = QLabel("Default Organization ID")
        self.org_input = QLineEdit()
        self.thread_label = QLabel("Concurrent Threads")
        self.thread_input = QSpinBox()
        self.thread_input.setRange(1, 10)
        self.thread_input.setValue(1)
        config_grid.addWidget(self.org_label, 0, 0)
        config_grid.addWidget(self.org_input, 0, 1)
        config_grid.addWidget(self.thread_label, 1, 0)
        config_grid.addWidget(self.thread_input, 1, 1)
        config_group.setLayout(config_grid)
        layout.addWidget(config_group)

        # Controls
        controls = QHBoxLayout()
        controls.addStretch(1)
        self.start_btn = QPushButton("Start")
        self.start_btn.setObjectName("primary")
        self.start_btn.clicked.connect(self.start_threads)
        controls.addWidget(self.start_btn)
        layout.addLayout(controls)

        # Logs group
        logs_group = QGroupBox("Logs")
        logs_v = QVBoxLayout()
        self.log_box = QTextEdit()
        self.log_box.setReadOnly(True)
        logs_v.addWidget(self.log_box)
        logs_group.setLayout(logs_v)
        layout.addWidget(logs_group)

        self.setLayout(layout)

    def log(self, message):
        self.log_box.append(message)

    def toggle_mode(self):
        bulk = self.mode_select.currentIndex() == 1
        self.single_group.setVisible(not bulk)
        self.bulk_group.setVisible(bulk)

    def browse_file(self):
        path, _ = QFileDialog.getOpenFileName(self, "Select accounts CSV", "", "CSV Files (*.csv);;All Files (*)")
        if path:
            self.file_input.setText(path)

    def start_threads(self):
        default_org = self.org_input.text().strip()
        max_threads = self.thread_input.value()

        accounts = []
        if self.mode_select.currentIndex() == 0:
            # Single
            email = self.email_input.text().strip()
            password = self.password_input.text().strip()
            otp_secret = self.otp_input.text().strip()
            if not email or not password:
                QMessageBox.warning(self, "Input Error", "Email and Password are required.")
                return
            if not default_org:
                QMessageBox.warning(self, "Input Error", "Organization ID is required (or provide per-account in CSV).")
                return
            accounts.append((email, password, otp_secret, default_org))
        else:
            # Bulk CSV
            path = self.file_input.text().strip()
            if not path or not os.path.exists(path):
                QMessageBox.warning(self, "Input Error", "Please select a valid CSV file.")
                return
            try:
                with open(path, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#"):
                            continue
                        parts = [p.strip() for p in line.split(",")]
                        if len(parts) < 2:
                            continue
                        email = parts[0]
                        password = parts[1]
                        otp_secret = parts[2] if len(parts) >= 3 else ""
                        org_id = parts[3] if len(parts) >= 4 else default_org
                        if not org_id:
                            self.log(f"Skipping {email}: missing organization id")
                            continue
                        accounts.append((email, password, otp_secret, org_id))
            except Exception as e:
                QMessageBox.critical(self, "Read Error", f"Failed to read accounts file: {e}")
                return

        if not accounts:
            QMessageBox.warning(self, "Input Error", "No valid accounts to process.")
            return

        self.log(f"🚀 Starting {len(accounts)} account(s) with up to {max_threads} concurrent thread(s)...")

        # Reset state
        self.pending_accounts = accounts
        self.active_workers = []

        # Launch initial batch
        self.launch_more_workers(max_threads)

    def launch_more_workers(self, max_threads):
        while len(self.active_workers) < max_threads and self.pending_accounts:
            email, password, otp_secret, org_id = self.pending_accounts.pop(0)
            worker = FirebaseWorker(email, password, org_id, otp_secret, len(self.active_workers) + 1)
            worker.log_signal.connect(self.log)
            worker.done_signal.connect(self.on_worker_done)
            self.active_workers.append(worker)
            worker.start()

    def on_worker_done(self, msg):
        # Remove finished worker
        sender = self.sender()
        if sender in self.active_workers:
            self.active_workers.remove(sender)
        self.log(msg)
        # Launch next if pending
        self.launch_more_workers(self.thread_input.value())

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = FirebaseCreatorUI()
    window.show()
    sys.exit(app.exec_())