import subprocess, time, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path('.').resolve()

def run_tests():
    server = subprocess.Popen([sys.executable, '-m', 'http.server', '8089', '--directory', str(ROOT / 'src')],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    try:
        with sync_playwright() as p:
            device = p.devices['Pixel 7']
            browser = p.chromium.launch(channel="msedge", headless=True)
            context = browser.new_context(**device)
            page = context.new_page()
            page.goto('http://localhost:8089/', wait_until='domcontentloaded')
            page.wait_for_selector('#app')

            sample_doc = ROOT / "test-docs" / "SQL Server Advanced Concepts.pdf"
            page.set_input_files("#file-input", str(sample_doc))
            page.wait_for_selector('#page-wrapper-1 .textLayer span', timeout=20000)
            page.wait_for_timeout(1500)

            print("=== TEST 1 & 2: In-Place Editing & Select-All Deletion ===")
            # Switch to Edit mode on mobile
            page.click('.m3-nav-item[data-m3-tab="edit"]')
            page.wait_for_timeout(400)
            page.click('#m3-close-edit')
            page.wait_for_timeout(300)

            # Find a text span on page 1
            span = page.query_selector('#page-wrapper-1 .textLayer span')
            assert span is not None, "No text span found on page 1"
            orig_text = span.inner_text()
            print(f"Original text span: {repr(orig_text)}")

            # Tap span to initiate in-place editing
            span.tap()
            page.wait_for_timeout(500)

            editor = page.query_selector('.inline-editing')
            assert editor is not None, "Editor .inline-editing span was not activated on tap"
            input_mode = editor.get_attribute('inputmode')
            assert input_mode == 'text', f"inputmode should be 'text', got {input_mode}"
            print("In-place editor activated with inputmode='text' successfully.")

            # Test typing Unicode characters with accents & descenders
            page.keyboard.type(" Sêrvér ğŷ çé")
            page.wait_for_timeout(300)
            typed_text = editor.inner_text()
            assert "Sêrvér ğŷ çé" in typed_text, f"Typed text not found in editor: {typed_text}"
            print(f"Unicode typing verified: {repr(typed_text)}")

            # Test Keyboard Select All (Control+a) does NOT move the PDF viewport
            scroll_before = page.evaluate('''() => {
                const c = document.getElementById('viewer-container');
                return { top: c ? c.scrollTop : 0, left: c ? c.scrollLeft : 0 };
            }''')

            # Press Control+A from keyboard inside the editor
            page.keyboard.press("Control+a")
            page.wait_for_timeout(300)

            scroll_after = page.evaluate('''() => {
                const c = document.getElementById('viewer-container');
                const sel = window.getSelection();
                const ed = document.querySelector('.inline-editing');
                const isInside = sel && sel.rangeCount > 0 && ed.contains(sel.getRangeAt(0).commonAncestorContainer);
                return { 
                    top: c ? c.scrollTop : 0, 
                    left: c ? c.scrollLeft : 0,
                    isInside,
                    bodyClassActive: document.body.classList.contains('in-place-editing-active')
                };
            }''')
            assert scroll_after['top'] == scroll_before['top'], f"Scroll top moved on Select All! Before: {scroll_before['top']}, After: {scroll_after['top']}"
            assert scroll_after['left'] == scroll_before['left'], f"Scroll left moved on Select All! Before: {scroll_before['left']}, After: {scroll_after['left']}"
            assert scroll_after['isInside'] is True, "Selection leaked outside of the active editor span!"
            assert scroll_after['bodyClassActive'] is True, "body.in-place-editing-active should be present while editing"
            print(f"Keyboard Select All (Ctrl+A) verified: viewport locked at scroll ({scroll_after['top']}, {scroll_after['left']}), selection strictly confined to editor.")

            # Backspace to clear selection
            page.keyboard.press("Backspace")
            page.wait_for_timeout(300)
            after_delete = editor.evaluate('el => el.textContent')
            assert after_delete == "", f"Editor text should be empty after backspace on select-all, got {repr(after_delete)}"

            # Blur to commit
            page.evaluate("() => document.activeElement.blur()")
            page.wait_for_timeout(600)
            print("Select-all and delete verified: text cleared without ghost fragments or edge traces.")

            print("=== TEST 3: Split PDF Range Validation ===")
            split_tests = [
                ("-", "hyphen only"),
                ("--", "double hyphen"),
                ("1-", "trailing hyphen"),
                ("-2", "leading hyphen"),
                ("abc", "alphabetic text"),
                ("0", "page 0"),
                ("0-2", "page 0-2"),
                ("99", "out-of-bounds page 99 on 13-page doc"),
                ("1-50", "out-of-bounds end range 50 on 13-page doc"),
                ("3-1", "reversed range")
            ]
            for val, desc in split_tests:
                res = page.evaluate('''async (val) => {
                    try {
                        await window.app.organizer.splitByRanges(window.app.currentPdfBytes, val);
                        return { error: null };
                    } catch (e) {
                        return { error: e.message };
                    }
                }''', val)
                assert res['error'] is not None, f"Expected validation error for {desc} ({val}), but none was thrown"
                print(f"Rejected invalid range '{val}' ({desc}): {res['error']}")

            # Valid range
            valid_res = page.evaluate('''async () => {
                try {
                    const parts = await window.app.organizer.splitByRanges(window.app.currentPdfBytes, "1-2");
                    return { success: true, count: parts.length, name: parts[0].name };
                } catch (e) {
                    return { success: false, error: e.message };
                }
            }''')
            assert valid_res['success'] is True, f"Valid range 1-2 failed: {valid_res.get('error')}"
            assert valid_res['count'] == 1, f"Expected 1 part, got {valid_res['count']}"
            assert "pages_1-2.pdf" in valid_res['name'], f"Expected pages_1-2.pdf in name, got {valid_res['name']}"
            print(f"Valid range '1-2' split successfully into {valid_res['name']}.")

            print("=== TEST 4: Split PDF Save Cancellation / Failure Handling ===")
            # Check that when downloadFiles fails or is cancelled, btnApplySplit shows failure toast and modal-export-result is NOT shown
            save_check = page.evaluate('''async () => {
                // Mock exporter.downloadFiles to simulate user cancellation
                const origDownload = window.app.exporter.downloadFiles;
                window.app.exporter.downloadFiles = async () => ({ success: false, cancelled: true });

                const splitInput = document.getElementById('split-ranges-input');
                splitInput.value = '1-2';
                const btn = document.getElementById('btn-apply-split');
                btn.click();

                // Wait for async handler
                await new Promise(r => setTimeout(r, 200));

                const modalOpen = document.getElementById('modal-export-result')?.classList.contains('open');
                window.app.exporter.downloadFiles = origDownload;
                return { modalOpen };
            }''')
            assert save_check['modalOpen'] is False, "modal-export-result should NOT be open when save is cancelled!"
            print("Split PDF cancellation verified: export result modal is not displayed.")

            # Test direct exporter.downloadFiles handling when native Share is dismissed/cancelled
            share_cancel_check = page.evaluate('''async () => {
                const origCapacitor = window.Capacitor;
                window.Capacitor = {
                    isNativePlatform: () => true,
                    platform: 'android',
                    Plugins: {
                        Filesystem: {
                            writeFile: async () => ({ uri: 'file:///mock/path.pdf' })
                        },
                        Share: {
                            share: async () => {
                                const err = new Error('User cancelled share');
                                err.name = 'AbortError';
                                throw err;
                            }
                        }
                    }
                };
                const res = await window.app.exporter.downloadFiles([
                    { fileName: 'part1.pdf', data: new Uint8Array([1, 2, 3]) }
                ]);
                window.Capacitor = origCapacitor;
                return res;
            }''')
            assert share_cancel_check['success'] is False, f"Expected success: false on share cancel, got {share_cancel_check['success']}"
            assert share_cancel_check['cancelled'] is True, f"Expected cancelled: true on share cancel, got {share_cancel_check['cancelled']}"
            print("Android Capacitor Share.share cancellation verified: success: false, cancelled: true.")

            print("=== TEST 5: Highlighter Custom Opacity ===")
            # Set opacity to 0.65 and verify stroke takes 0.65
            annot_check = page.evaluate('''() => {
                window.app.annotator.setTool('highlighter', { opacity: 0.65, strokeWidth: 18, color: '#eab308' });
                return {
                    currentOpacity: window.app.annotator.opacity,
                    highlighterOpacity: window.app.annotator.highlighterSettings.opacity,
                    highlighterWidth: window.app.annotator.highlighterSettings.strokeWidth
                };
            }''')
            assert annot_check['currentOpacity'] == 0.65, f"Annotator opacity should be 0.65, got {annot_check['currentOpacity']}"
            assert annot_check['highlighterOpacity'] == 0.65, f"highlighterSettings opacity should be 0.65, got {annot_check['highlighterOpacity']}"
            assert annot_check['highlighterWidth'] == 18, f"highlighterSettings width should be 18, got {annot_check['highlighterWidth']}"

            # Simulate drawing a highlighter stroke and verify stored annotation opacity
            page.evaluate('''() => {
                const canvas = document.getElementById('annot-canvas-1');
                window.app.annotator.isDrawing = true;
                window.app.annotator.activeCanvas = canvas;
                window.app.annotator.activePageNum = 1;
                window.app.annotator.currentPath = [{ x: 50, y: 50 }, { x: 150, y: 50 }];
                window.app.annotator._onMouseUp();
            }''')
            stroke_annot = page.evaluate('''() => {
                const list = window.app.annotator.annotations.get(1) || [];
                return list[list.length - 1];
            }''')
            assert stroke_annot['type'] == 'highlighter', f"Expected highlighter type, got {stroke_annot['type']}"
            assert stroke_annot['opacity'] == 0.65, f"Expected stroke opacity 0.65, got {stroke_annot['opacity']}"
            assert stroke_annot['strokeWidth'] == 18, f"Expected stroke width 18, got {stroke_annot['strokeWidth']}"
            print(f"Highlighter stroke successfully created with custom opacity {stroke_annot['opacity']} and width {stroke_annot['strokeWidth']}.")

            print("=== TEST 6: Menu Switching Setting Retention (Desktop & Mobile) ===")
            # Desktop: set highlighter settings, switch modes, verify retention
            desktop_check = page.evaluate('''() => {
                window.app.ui.setMode('annotate');
                window.app.annotator.setTool('highlighter', { color: '#16a34a', strokeWidth: 15, opacity: 0.50 });
                // Switch to view
                window.app.ui.setMode('view');
                // Switch back to annotate
                window.app.ui.setMode('annotate');
                
                const activeTool = window.app.annotator.currentTool;
                const lastTool = window.app.annotator.lastAnnotTool;
                const colorVal = document.getElementById('annot-color')?.value;
                const sizeVal = document.getElementById('annot-size')?.value;
                const opacityVal = document.getElementById('annot-opacity')?.value;
                const btnHighlActive = document.getElementById('tool-highlighter')?.classList.contains('active');
                
                return {
                    activeTool,
                    lastTool,
                    colorVal,
                    sizeVal: parseInt(sizeVal, 10),
                    opacityVal: parseInt(opacityVal, 10),
                    btnHighlActive,
                    annotColor: window.app.annotator.color,
                    annotWidth: window.app.annotator.strokeWidth,
                    annotOpacity: window.app.annotator.opacity
                };
            }''')
            print("Desktop menu switch result:", desktop_check)
            assert desktop_check['activeTool'] == 'highlighter', f"Expected activeTool highlighter, got {desktop_check['activeTool']}"
            assert desktop_check['btnHighlActive'] is True, "tool-highlighter button should be active"
            assert desktop_check['colorVal'] == '#16a34a', f"Expected #16a34a, got {desktop_check['colorVal']}"
            assert desktop_check['sizeVal'] == 15, f"Expected size 15, got {desktop_check['sizeVal']}"
            assert desktop_check['opacityVal'] == 50, f"Expected opacity 50, got {desktop_check['opacityVal']}"
            assert desktop_check['annotOpacity'] == 0.5, f"Expected annotator opacity 0.5, got {desktop_check['annotOpacity']}"

            # Mobile: open markup sheet, adjust sliders, switch tabs, verify retention
            mobile_check = page.evaluate('''() => {
                // Open mobile markup sheet
                document.querySelector('.m3-nav-item[data-m3-tab="annotate"]').click();
                
                // Select highlighter chip and set custom values
                const highlChip = document.querySelector('.m3-chip[data-m3-tool="highlighter"]');
                highlChip.click();
                
                // Change stroke slider to 22 and opacity slider to 75%
                const strokeSlider = document.getElementById('m3-stroke-slider');
                strokeSlider.value = '22';
                strokeSlider.dispatchEvent(new Event('input'));
                
                const opacitySlider = document.getElementById('m3-opacity-slider');
                opacitySlider.value = '75';
                opacitySlider.dispatchEvent(new Event('input'));
                
                // Set color to blue #3b82f6
                const blueDot = document.querySelector('#m3-color-palette .color-dot[data-m3-color="#3b82f6"]');
                blueDot.click();
                
                // Switch to read tab
                document.querySelector('.m3-nav-item[data-m3-tab="read"]').click();
                
                // Switch back to annotate tab
                document.querySelector('.m3-nav-item[data-m3-tab="annotate"]').click();
                
                return {
                    tool: window.app.annotator.currentTool,
                    strokeVal: document.getElementById('m3-stroke-slider')?.value,
                    opacityVal: document.getElementById('m3-opacity-slider')?.value,
                    color: window.app.annotator.color,
                    highlighterWidth: window.app.annotator.highlighterSettings.strokeWidth,
                    highlighterOpacity: window.app.annotator.highlighterSettings.opacity,
                    highlighterColor: window.app.annotator.highlighterSettings.color
                };
            }''')
            print("Mobile menu switch result:", mobile_check)
            assert mobile_check['strokeVal'] == '22', f"Expected stroke slider 22, got {mobile_check['strokeVal']}"
            assert mobile_check['opacityVal'] == '75', f"Expected opacity slider 75, got {mobile_check['opacityVal']}"
            assert mobile_check['highlighterWidth'] == 22, f"Expected highlighter width 22, got {mobile_check['highlighterWidth']}"
            assert mobile_check['highlighterOpacity'] == 0.75, f"Expected highlighter opacity 0.75, got {mobile_check['highlighterOpacity']}"
            assert mobile_check['highlighterColor'] == '#3b82f6', f"Expected highlighter color #3b82f6, got {mobile_check['highlighterColor']}"

            print("\nALL 6 BUGS VERIFIED AND PASSING SUCCESSFULLY!")

    finally:
        server.terminate()

if __name__ == '__main__':
    run_tests()
