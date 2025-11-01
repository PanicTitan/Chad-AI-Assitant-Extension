const debug = true;

export async function screenshot(promise?: Promise<string>, resolve?: (value: string | PromiseLike<string>) => void) {
    if (debug) console.log("screenshot");

    if (!promise && !resolve) {
        let object = Promise.withResolvers<string>();
        promise = object.promise;
        resolve = object.resolve
    }

    try {
        chrome.tabs.captureVisibleTab({ format: "png", quality: 100 }, (dataUrl) => {
            resolve!(dataUrl);
        });

        if (debug) console.log("screenshot success");

        return promise;
    } catch (error) {
        if (debug) console.log("screenshot failed, trying again");

        await new Promise((resolve) => setTimeout(() => {
            resolve(undefined)
        }, (1000 / chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND) + 50));

        return screenshot(promise, resolve);
    }
}

// /**
//  * Opens a URL in a background tab, extracts its full HTML content,
//  * closes the tab, and returns the content.
//  *
//  * @param {string} url The URL to fetch content from.
//  * @returns {Promise<string>} A promise that resolves with the HTML content of the page.
//  */
// export function fetchPageContent(url: string) {
//     return new Promise((resolve, reject) => {
//         // 1. Create the tab. It's inactive so it doesn't interrupt the user.
//         chrome.tabs.create({ url, active: false }, (tab) => {
//             // Listener function to be executed when the tab is updated.
//             const tabUpdateListener: (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => void = (tabId, changeInfo, updatedTab) => {
//                 // We are only interested in updates for our specific tab and when it's fully loaded.
//                 if (tabId === tab.id && changeInfo.status === 'complete') {
//                     // 2. The tab is loaded, now we can inject the script.
//                     chrome.scripting.executeScript({
//                         target: { tabId: tab.id },
//                         // This function will be executed in the context of the created tab.
//                         func: () => document.documentElement.outerHTML
//                     }, (injectionResults) => {
//                         // Error handling
//                         if (chrome.runtime.lastError) {
//                             reject(new Error(chrome.runtime.lastError.message));
//                             // Clean up the created tab on error
//                             chrome.tabs.remove(tab.id!);
//                             return;
//                         }
//                         if (!injectionResults || injectionResults.length === 0) {
//                             reject(new Error("Script injection failed or produced no results."));
//                             // Clean up the created tab
//                             chrome.tabs.remove(tab.id!);
//                             return;
//                         }

//                         // The result of the script injection is an array. We want the first element's result.
//                         const pageContent = injectionResults[0].result;

//                         // 3. We have the content, so we can close the tab.
//                         chrome.tabs.remove(tab.id!, () => {
//                             // 4. Resolve the promise with the extracted content.
//                             resolve(pageContent);
//                         });
//                     });

//                     // Important: Remove the listener after we're done to prevent memory leaks.
//                     chrome.tabs.onUpdated.removeListener(tabUpdateListener);
//                 }
//             };

//             // Add the listener to chrome.tabs.onUpdated
//             chrome.tabs.onUpdated.addListener(tabUpdateListener);
//         });
//     });
// }




// /**
//  * [New Function]
//  * Opens a URL in a background tab, extracts its visible text content,
//  * closes the tab, and returns the text.
//  *
//  * @param {string} url The URL to fetch text from.
//  * @returns {Promise<string>} A promise that resolves with the text content of the page.
//  */
// export function fetchPageText(url: string): Promise<string> {
//     return new Promise((resolve, reject) => {
//         chrome.tabs.create({ url, active: false }, (tab) => {
//             const tabUpdateListener: (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => void = (tabId, changeInfo) => {
//                 if (tabId === tab.id && changeInfo.status === 'complete') {
//                     // The injected function now gets the body's innerText.
//                     chrome.scripting.executeScript({
//                         target: { tabId: tab.id },
//                         func: () => document.body.innerText
//                     }, (injectionResults) => {
//                         if (chrome.runtime.lastError || !injectionResults || injectionResults.length === 0) {
//                             reject(new Error(chrome.runtime.lastError?.message || "Script injection failed."));
//                             chrome.tabs.remove(tab.id!); return;
//                         }
//                         const pageText = injectionResults[0].result;
//                         chrome.tabs.remove(tab.id!, () => resolve(pageText ?? ""));
//                     });
//                     chrome.tabs.onUpdated.removeListener(tabUpdateListener);
//                 }
//             };
//             chrome.tabs.onUpdated.addListener(tabUpdateListener);
//         });
//     });
// }

// /**
//  * [Final Robust Version]
//  * Takes a screenshot of a URL by loading it in an invisible background tab,
//  * then activating it for a fraction of a second to perform the capture.
//  * A controlled delay is added to prevent the "image readback failed" race condition.
//  *
//  * @param {string} url The URL to take a screenshot of.
//  * @param {object} [options] Options for screenshot (e.g., { format: 'png', quality: 100 }).
//  * @returns {Promise<string>} A promise that resolves with the data URL of the screenshot.
//  */
// export function fetchPageScreenshot(url: string, options = { format: 'png', quality: 100 }) {
//     return new Promise(async (resolve, reject) => {

//         // 1. Get the user's current tab to return focus to it later.
//         const [originalTab] = await chrome.tabs.query({ active: true, currentWindow: true,  });

//         // 2. Create the tab in the background, keeping it inactive.
//         chrome.tabs.create({ url, active: false }, (tab) => {

//             const tabUpdateListener: (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => void = (tabId, changeInfo) => {
//                 // 3. Wait for our background tab to finish loading completely.
//                 if (tabId === tab.id && changeInfo.status === 'complete') {

//                     // The tab is loaded, now start the capture sequence.
//                     (async () => {
//                         try {
//                             // 4. Make our tab active.
//                             await chrome.tabs.update(tab.id, { active: true });

//                             // 5. THE FIX: Wait for a brief moment (e.g., 150ms) to allow the
//                             // browser to fully render the page before we capture it.
//                             // This prevents the "image readback failed" error.
//                             await new Promise(res => setTimeout(res, 150));

//                             // 6. Now that the page is painted, capture the visible tab.
//                             // @ts-ignore
//                             const dataUrl = await chrome.tabs.captureVisibleTab(null, options);

//                             resolve(dataUrl);

//                         } catch (error) {
//                             reject(error);
//                         } finally {
//                             // 7. CRITICAL CLEANUP: This always runs.
//                             // First, remove our temporary tab.
//                             // Await this to prevent race conditions in the next step.
//                             if (tab) {
//                                 await chrome.tabs.remove(tab.id!).catch(e => console.log(e));
//                             }
//                             // Then, ensure the user's original tab is active again.
//                             if (originalTab) {
//                                 await chrome.tabs.update(originalTab.id, { active: true }).catch(e => console.log(e));
//                             }
//                         }
//                     })();

//                     // 8. Remove the listener to prevent it from firing again.
//                     chrome.tabs.onUpdated.removeListener(tabUpdateListener);
//                 }
//             };

//             chrome.tabs.onUpdated.addListener(tabUpdateListener);
//         });
//     });
// }

// /**
//  * Opens a URL in a background incognito window, extracts its full HTML content,
//  * closes the window, and returns the content.
//  *
//  * @param {string} url The URL to fetch content from.
//  * @returns {Promise<string>} A promise that resolves with the HTML content of the page.
//  */
// export function fetchPageContentInIncognito(url: string): Promise<string> {
//     return new Promise((resolve, reject) => {
//         // 1. Create an incognito window. We can try to make it non-disruptive
//         // by setting focused: false and state: 'minimized'.
//         chrome.windows.create({ url, incognito: true, focused: false, state: 'minimized' }, (window) => {
//             if (!window || !window.tabs || window.tabs.length === 0) {
//                 return reject(new Error("Failed to create incognito window or tab."));
//             }

//             const tab = window.tabs[0];
//             const tabId = tab.id!;

//             const tabUpdateListener = (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
//                 // We are only interested in updates for our specific tab and when it's fully loaded.
//                 if (updatedTabId === tabId && changeInfo.status === 'complete') {
//                     // 2. The tab is loaded, now we can inject the script.
//                     chrome.scripting.executeScript({
//                         target: { tabId: tabId },
//                         func: () => document.documentElement.outerHTML
//                     }, (injectionResults) => {
//                         // Error handling
//                         if (chrome.runtime.lastError) {
//                             reject(new Error(chrome.runtime.lastError.message));
//                             chrome.windows.remove(window.id!); // Clean up window on error
//                             return;
//                         }
//                         if (!injectionResults || injectionResults.length === 0) {
//                             reject(new Error("Script injection failed or produced no results."));
//                             chrome.windows.remove(window.id!); // Clean up window
//                             return;
//                         }

//                         const pageContent = injectionResults[0].result;

//                         // 3. We have the content, so we can close the entire incognito window.
//                         chrome.windows.remove(window.id!, () => {
//                             // 4. Resolve the promise with the extracted content.
//                             resolve(pageContent!);
//                         });
//                     });

//                     // Important: Remove the listener to prevent memory leaks.
//                     chrome.tabs.onUpdated.removeListener(tabUpdateListener);
//                 }
//             };

//             chrome.tabs.onUpdated.addListener(tabUpdateListener);
//         });
//     });
// }


/**
 * Defines the options for processing a URL in a new tab or window.
 */
export interface ProcessUrlOptions {
    /**
     * If true, opens the URL in a new incognito window. Requires user permission.
     * @default false
     */
    incognito?: boolean;

    /**
     * If true, the new tab/window will be focused.
     * @default false
     */
    active?: boolean;

    /**
     * If true, the tab/window will be automatically closed after the handler function completes.
     * @default true
     */
    closeOnComplete?: boolean;

    /**
     * The desired state of the new window (e.g., 'minimized', 'maximized').
     * Only applies when `incognito` is true or a new window is otherwise created.
     * @default 'normal'
     */
    windowState?: "normal" | "minimized" | "maximized" | "fullscreen" | "locked-fullscreen" | undefined;
}

/**
 * [CORE FUNCTION - CORRECTED VERSION]
 * A generic executor that opens a URL in a new tab/window, waits for it to load,
 * executes a provided handler function to process it, and then cleans up.
 *
 * @param {string} url The URL to open.
 * @param {ProcessUrlOptions} options Configuration for how to open and handle the tab/window.
 * @param {(tab: chrome.tabs.Tab) => Promise<T>} handler A function that receives the loaded tab
 *   and performs an action, returning a promise that resolves with the result.
 * @returns {Promise<T>} A promise that resolves with the result from the handler function.
 */
export async function processUrlInTab<T>(
    url: string,
    options: ProcessUrlOptions,
    handler: (tab: chrome.tabs.Tab) => Promise<T>
): Promise<T> {
    const {
        incognito = await chrome.extension.isAllowedIncognitoAccess(),
        active = false, // This now maps to 'focused' for windows and 'active' for tabs
        closeOnComplete = true,
        windowState = 'minimized'
    } = options;

    return new Promise(async (resolve, reject) => {
        // THE FIX: We now create the correct properties object depending on
        // whether we are creating a window or a tab.
        const createPromise = incognito
            ? chrome.windows.create({
                url,
                incognito: true,
                state: windowState,
                focused: active // Use 'focused' for windows
            })
            : chrome.tabs.create({
                url,
                active: active // Use 'active' for tabs
            });

        createPromise.then(windowOrTab => {
            // Normalize the result to get the tab and window IDs
            const tab = incognito ? (windowOrTab as chrome.windows.Window).tabs![0] : (windowOrTab as chrome.tabs.Tab);
            const tabId = tab.id!;
            const windowId = tab.windowId;

            const tabUpdateListener = async (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    // Stop listening to prevent memory leaks and duplicate executions
                    chrome.tabs.onUpdated.removeListener(tabUpdateListener);

                    try {
                        // Execute the provided action (handler) and wait for its result
                        const result = await handler(tab);
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    } finally {
                        // Cleanup: Close the tab/window if requested
                        if (closeOnComplete) {
                            if (incognito && windowId) {
                                await chrome.windows.remove(windowId).catch(e => console.error(`Error removing window: ${e.message}`));
                            } else {
                                await chrome.tabs.remove(tabId).catch(e => console.error(`Error removing tab: ${e.message}`));
                            }
                        }
                    }
                }
            };

            chrome.tabs.onUpdated.addListener(tabUpdateListener);

        }).catch(reject); // Catch errors during tab/window creation
    });
}

/**
 * Fetches the full HTML content of a URL.
 *
 * @param {string} url The URL to fetch content from.
 * @param {ProcessUrlOptions} [options] Options for how to process the URL (e.g., incognito).
 * @returns {Promise<string>} A promise that resolves with the HTML content of the page.
 */
export function fetchPageContent(url: string, options: ProcessUrlOptions = {}): Promise<string> {
    const handler = async (tab: chrome.tabs.Tab): Promise<string> => {
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            func: () => document.documentElement.outerHTML
        });
        if (!injectionResults || injectionResults.length === 0) {
            throw new Error("Script injection for HTML content failed.");
        }
        return injectionResults[0].result!;
    };

    return processUrlInTab(url, options, handler);
}

/**
 * Fetches the visible text content of a URL.
 *
 * @param {string} url The URL to fetch text from.
 * @param {ProcessUrlOptions} [options] Options for how to process the URL (e.g., incognito).
 * @returns {Promise<string>} A promise that resolves with the text content of the page.
 */
export function fetchPageText(url: string, options: ProcessUrlOptions = {}): Promise<string> {
    const handler = async (tab: chrome.tabs.Tab): Promise<string> => {
        const injectionResults = await chrome.scripting.executeScript({
            target: { tabId: tab.id! },
            func: () => document.body.innerText
        });
        if (!injectionResults || injectionResults.length === 0) {
            throw new Error("Script injection for text content failed.");
        }
        return injectionResults[0].result ?? "";
    };

    return processUrlInTab(url, options, handler);
}

/**
 * Captures a screenshot of a URL.
 *
 * @param {string} url The URL to take a screenshot of.
 * @param {ProcessUrlOptions} [options] Options for how to process the URL.
 * @param {chrome.tabs.CaptureVisibleTabOptions} [screenshotOptions] Options for the screenshot itself (format, quality).
 * @returns {Promise<string>} A promise that resolves with the data URL of the screenshot.
 */
export async function fetchPageScreenshot(
    url: string,
    options: ProcessUrlOptions = {},
    screenshotOptions: chrome.extensionTypes.ImageDetails = { format: 'png', quality: 100 }
): Promise<string> {
    // We need to know the original tab to return focus to it.
    const [originalTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const handler = async (tab: chrome.tabs.Tab): Promise<string> => {
        // Temporarily activate the tab to make it "visible" for capture
        await chrome.tabs.update(tab.id!, { active: true });

        // A crucial delay to prevent the "image readback failed" race condition
        await new Promise(res => setTimeout(res, 150));

        // @ts-ignore - captureVisibleTab's first argument (windowId) is optional
        const dataUrl = await chrome.tabs.captureVisibleTab(null, screenshotOptions);

        // Restore focus to the original tab before we close the temporary one
        if (originalTab?.id) {
            await chrome.tabs.update(originalTab.id, { active: true }).catch(e => console.error(e));
        }

        return dataUrl!;
    };

    // Force the tab to be created inactive, as the handler will activate it.
    const processOptions = { ...options, active: false };
    return processUrlInTab(url, processOptions, handler);
}
