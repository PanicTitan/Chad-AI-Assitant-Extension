import { z } from 'zod';
import { createTool, type Tools } from './built-in-ai-ex/Agent';
import { SummarizerEx } from './built-in-ai-ex/SummarizerEx';
import { LanguageModelEx } from './built-in-ai-ex/LanguageModelEx';
import { screenshot, fetchPageText, fetchPageContent } from './extensionHelper';

// Helper to convert data URL to Blob
async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
    const response = await fetch(dataUrl);
    return await response.blob();
}

// Get localized date time string
function getLocalizedDateTimeString(): string {
    const now = new Date();
    return now.toLocaleString();
}

interface AgentToolsOptions {
    onScreenshotRequest?: () => Promise<Blob | null>;
    onUserQuestion?: (question: string, dataType: 'text' | 'image' | 'audio') => Promise<string>;
}

export function createAgentTools(options?: AgentToolsOptions): Tools {
    return {
        getCurrentTabPrint: createTool({
            name: "getCurrentTabPrint",
            description: `Get the user vision from a print screen image of the current active tab. Can be used when the subject of the request is not in the prompt, maybe it is on the user screen. You can process this by your self no need of external tools.`,
            inputSchema: z.object({}),
            async execute() {
                console.log("Tool call -> Current Tab Screenshot");
                
                if (options?.onScreenshotRequest) {
                    const blob = await options.onScreenshotRequest();
                    if (blob) return blob;
                }
                
                // Use the existing screenshot function from extensionHelper
                // This captures the current visible tab without requiring user permission
                const dataUrl = await screenshot();
                console.log("Tool call -> Screenshot captured");
                
                if (!dataUrl) {
                    throw new Error('Failed to capture screenshot');
                }
                
                return await dataUrlToBlob(dataUrl);
            },
            examples: []
        }),

        searchOnGoogle: createTool({
            name: "searchOnGoogle",
            description: `Search on Google and get summarized results. Only use this when very necessary, as it opens a background tab.`,
            inputSchema: z.object({
                search: z.string().describe("Query to search on google.")
            }),
            async execute(args) {
                console.log("Tool call -> Web Search:", args.search);
                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(args.search)}`;
                
                // Use extensionHelper's fetchPageText which opens in a background tab
                // and automatically closes it after extracting the text
                const content = await fetchPageText(searchUrl);
                console.log("Tool call -> Content extracted, length:", content.length);
                
                const summarizerEx = await SummarizerEx.create({
                    format: "plain-text",
                    length: "long",
                    type: "tldr"
                });
                const summary = await summarizerEx.summarize(content, { 
                    context: `Its a web search about: ${args.search}` 
                });
                console.log("Tool call -> Summary generated");
                summarizerEx.destroy();
                
                return summary;
            },
            examples: [
                {
                    search: "What is the dollar value today."
                },
            ]
        }),

        searchOnWebPage: createTool({
            name: "searchOnWebPage",
            description: `Retrieve content from a specified web page and extract specific information based on a search focus. Opens the page in a background tab, extracts content, and automatically closes it. If \`extractSpecificInfo\` is set to true, the LLM should focus on pinpointing and providing the requested details. Otherwise, it should summarize the page content.`,
            inputSchema: z.object({
                url: z.string().describe("URL of the web page to search."),
                searchFocus: z.string().describe("A concise phrase describing the information to find on the web page."),
                extractSpecificInfo: z.boolean().describe("Indicates whether to extract specific data points related to the `searchFocus`. Set to 'true' for detailed information, 'false' for a summary."),
            }),
            async execute(args) {
                console.log("Tool call -> Get Web Page:", args);
                
                // Use extensionHelper's fetchPageText - opens in background tab and auto-closes
                const content = await fetchPageText(args.url);
                console.log("Tool call -> Content extracted, length:", content.length);

                let toReturnInfo = content;

                if (args.extractSpecificInfo) {
                    console.log("Tool call -> Extracting specific info");
                    const llmEx = await LanguageModelEx.create({
                        initialPrompts: [
                            {
                                role: "system",
                                content: `You must find the "${args.searchFocus}" on this data. I don't want a summary, I want the specific data points.`,
                            },
                        ],
                    });
                    const info = await llmEx.prompt(content);
                    llmEx.destroy();
                    console.log("Tool call -> Specific info extracted");
                    toReturnInfo = info;
                } else {
                    console.log("Tool call -> Summarizing content");
                    const summarizerEx = await SummarizerEx.create({
                        format: "plain-text",
                        length: "long",
                        type: "tldr",
                    });
                    const summary = await summarizerEx.summarize(content, { 
                        context: `I'm searching for: ${args.searchFocus}. Focus on summarizing the key information.` 
                    });
                    summarizerEx.destroy();
                    console.log("Tool call -> Summary generated");
                    toReturnInfo = summary;
                }

                return toReturnInfo;
            },
            examples: [
                {
                    url: "https://youtube.com",
                    searchFocus: "cakes recipes videos using chocolate",
                    extractSpecificInfo: false,
                },
                {
                    url: `https://freethevbucks.com/timed-missions/`,
                    searchFocus: "Only V-buck mission",
                    extractSpecificInfo: true,
                },
            ],
        }),

        readFromClipboard: createTool({
            name: "readFromClipboard",
            description: "Reads the current text content from the user's clipboard. Requires user permission.",
            inputSchema: z.object({}),
            examples: [],
            execute: async () => {
                try {
                    const text = await navigator.clipboard.readText();
                    if (!text) {
                        return "The clipboard is empty.";
                    }
                    return text;
                } catch (err) {
                    console.error("Clipboard read failed:", err);
                    return "Error: Could not read from clipboard. The user may have denied permission.";
                }
            },
        }),

        fetchImage: createTool({
            name: "fetchImage",
            description: "Fetches an image from a given URL and returns it.",
            inputSchema: z.object({
                url: z.string().url().describe("The direct URL of the image to fetch."),
            }),
            examples: [{ url: "https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png" }],
            execute: async ({ url }) => {
                try {
                    const response = await fetch(url);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch image with status ${response.status}`);
                    }
                    const imageBlob = await response.blob();
                    return imageBlob;
                } catch (err) {
                    console.error("Image fetch failed:", err);
                    throw new Error("Could not fetch the image from the URL.");
                }
            },
        }),

        manageTabs: createTool({
            name: "manageTabs",
            description: "Performs actions on browser tabs, such as finding, grouping, or closing them based on a query.",
            inputSchema: z.object({
                action: z.enum(["find", "group", "close"]).describe("The action to perform on the tabs."),
                query: z.string().describe("A search query to match against tab titles and URLs. E.g., 'youtube.com' or 'Meeting Notes'."),
                groupName: z.string().optional().describe("The name for the new tab group, only used when the action is 'group'."),
            }),
            examples: [
                { action: "find", query: "Google Docs" },
                { action: "group", query: "amazon.com", groupName: "Shopping" }
            ],
            execute: async ({ action, query, groupName }) => {
                const tabs = await chrome.tabs.query({});
                const matchedTabs = tabs.filter(tab => 
                    tab.url?.includes(query) || tab.title?.includes(query)
                );

                if (matchedTabs.length === 0) {
                    return `No tabs found matching query: "${query}"`;
                }
                
                const tabIds = matchedTabs.map(tab => tab.id!).filter(id => id !== undefined);

                switch (action) {
                    case "find":
                        // Focus the first found tab
                        await chrome.tabs.update(tabIds[0], { active: true });
                        if (matchedTabs[0].windowId) {
                            await chrome.windows.update(matchedTabs[0].windowId, { focused: true });
                        }
                        return `Found ${matchedTabs.length} tabs. Focused the first one: "${matchedTabs[0].title}"`;

                    case "group":
                        // @ts-ignore
                        const groupId = await chrome.tabs.group({ tabIds });
                        // @ts-ignore
                        await chrome.tabGroups.update(groupId, { title: groupName || query });
                        return `Successfully grouped ${matchedTabs.length} tabs under the name "${groupName || query}".`;
                        
                    case "close":
                        await chrome.tabs.remove(tabIds);
                        return `Successfully closed ${matchedTabs.length} tabs.`;
                }
            },
        }),

        searchHistory: createTool({
            name: "searchHistory",
            description: "Searches the user's browsing history for pages they have visited. Can filter by date range and return detailed visit information.",
            inputSchema: z.object({
                query: z.string().describe("The text to search for in the page titles and URLs of the user's history."),
                maxResults: z.number().optional().default(10).describe("The maximum number of results to return."),
                startTime: z.string().optional().describe("Limit results to those visited after this date (ISO 8601 format or relative like '24 hours ago')."),
                endTime: z.string().optional().describe("Limit results to those visited before this date (ISO 8601 format)."),
            }),
            examples: [
                { query: "WebGPU tutorial", maxResults: 5 },
                { query: "github", maxResults: 10, startTime: "7 days ago" }
            ],
            execute: async ({ query, maxResults, startTime, endTime }) => {
                // Parse relative time strings
                let startTimeMs: number | undefined;
                if (startTime) {
                    if (startTime.includes('ago')) {
                        const match = startTime.match(/(\d+)\s+(hour|day|week|month)s?\s+ago/i);
                        if (match) {
                            const value = parseInt(match[1]);
                            const unit = match[2].toLowerCase();
                            const now = Date.now();
                            const multipliers: Record<string, number> = {
                                'hour': 3600000,
                                'day': 86400000,
                                'week': 604800000,
                                'month': 2592000000
                            };
                            startTimeMs = now - (value * multipliers[unit]);
                        }
                    } else {
                        startTimeMs = new Date(startTime).getTime();
                    }
                }

                const endTimeMs = endTime ? new Date(endTime).getTime() : undefined;

                const results = await chrome.history.search({ 
                    text: query, 
                    maxResults,
                    startTime: startTimeMs,
                    endTime: endTimeMs
                });

                if (results.length === 0) {
                    return `No history items found for query: "${query}"`;
                }

                const summary = results.map(item => ({
                    title: item.title || 'Untitled',
                    url: item.url,
                    lastVisit: new Date(item.lastVisitTime!).toLocaleString(),
                    visitCount: item.visitCount,
                    typedCount: item.typedCount,
                }));

                return JSON.stringify(summary, null, 2);
            },
        }),

        searchOpenTabs: createTool({
            name: "searchOpenTabs",
            description: "Searches currently open tabs by title or URL. Returns information about matching tabs.",
            inputSchema: z.object({
                query: z.string().describe("The text to search for in tab titles and URLs."),
            }),
            examples: [{ query: "github" }],
            execute: async ({ query }) => {
                const tabs = await chrome.tabs.query({});
                const matchedTabs = tabs.filter(tab => 
                    tab.url?.toLowerCase().includes(query.toLowerCase()) || 
                    tab.title?.toLowerCase().includes(query.toLowerCase())
                );

                if (matchedTabs.length === 0) {
                    return `No open tabs found matching query: "${query}"`;
                }

                const summary = matchedTabs.map(tab => ({
                    title: tab.title,
                    url: tab.url,
                    active: tab.active,
                }));

                return JSON.stringify(summary, null, 2);
            },
        }),

        goToTab: createTool({
            name: "goToTab",
            description: "Switches to a specific tab by searching for it by title or URL, or opens a new tab with the given URL.",
            inputSchema: z.object({
                query: z.string().describe("Tab title, URL substring to search for, or full URL to open."),
            }),
            examples: [
                { query: "Gmail" },
                { query: "https://github.com" }
            ],
            execute: async ({ query }) => {
                // Check if it's a URL
                const isUrl = query.startsWith('http://') || query.startsWith('https://') || query.includes('.');

                if (isUrl) {
                    // Try to find existing tab with this URL first
                    const tabs = await chrome.tabs.query({});
                    const matchedTab = tabs.find(tab => tab.url?.includes(query));

                    if (matchedTab && matchedTab.id) {
                        await chrome.tabs.update(matchedTab.id, { active: true });
                        if (matchedTab.windowId) {
                            await chrome.windows.update(matchedTab.windowId, { focused: true });
                        }
                        return `Switched to existing tab: "${matchedTab.title}"`;
                    }

                    // Open new tab with URL
                    const newTab = await chrome.tabs.create({ url: query, active: true });
                    return `Opened new tab: ${query}`;
                }

                // Search for tab by title or URL
                const tabs = await chrome.tabs.query({});
                const matchedTab = tabs.find(tab => 
                    tab.title?.toLowerCase().includes(query.toLowerCase()) || 
                    tab.url?.toLowerCase().includes(query.toLowerCase())
                );

                if (!matchedTab) {
                    return `No tab found matching query: "${query}"`;
                }

                if (matchedTab.id) {
                    await chrome.tabs.update(matchedTab.id, { active: true });
                    if (matchedTab.windowId) {
                        await chrome.windows.update(matchedTab.windowId, { focused: true });
                    }
                    return `Switched to tab: "${matchedTab.title}"`;
                }

                return `Found tab but couldn't switch to it.`;
            },
        }),

        createTabGroup: createTool({
            name: "createTabGroup",
            description: "Creates a new tab group with specified tabs. Can group tabs by URL pattern or tab IDs. Supports collapsing groups and custom colors.",
            inputSchema: z.object({
                groupName: z.string().describe("Name for the new tab group."),
                query: z.string().describe("URL pattern or title substring to match tabs for grouping. Use | to separate multiple patterns."),
                color: z.enum(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']).optional().describe("Color for the tab group."),
                collapsed: z.boolean().optional().default(false).describe("Whether the group should be collapsed."),
            }),
            examples: [
                { groupName: "Social Media", query: "twitter.com|facebook.com|instagram.com", color: "pink", collapsed: false },
                { groupName: "Work", query: "slack|notion|gmail", color: "blue", collapsed: false },
                { groupName: "Documentation", query: "docs|documentation|api", color: "green", collapsed: false }
            ],
            execute: async ({ groupName, query, color, collapsed }) => {
                const tabs = await chrome.tabs.query({});
                const patterns = query.toLowerCase().split('|').map(p => p.trim());
                
                const matchedTabs = tabs.filter(tab => 
                    patterns.some(pattern => 
                        tab.url?.toLowerCase().includes(pattern) || 
                        tab.title?.toLowerCase().includes(pattern)
                    )
                );

                if (matchedTabs.length === 0) {
                    return `No tabs found matching patterns: "${query}"`;
                }

                const tabIds = matchedTabs.map(tab => tab.id!).filter(id => id !== undefined);

                // @ts-ignore
                const groupId = await chrome.tabs.group({ tabIds });
                // @ts-ignore
                const updateOptions: any = { title: groupName };
                if (color) updateOptions.color = color;
                if (collapsed !== undefined) updateOptions.collapsed = collapsed;
                // @ts-ignore
                await chrome.tabGroups.update(groupId, updateOptions);

                const tabList = matchedTabs.map(t => `  - ${t.title}`).join('\n');
                return `Created group "${groupName}" with ${matchedTabs.length} tabs:\n${tabList}`;
            },
        }),

        organizeTabsAutomatically: createTool({
            name: "organizeTabsAutomatically",
            description: "Automatically organizes all open tabs into groups by domain or category. Useful for cleaning up many tabs.",
            inputSchema: z.object({
                strategy: z.enum(['domain', 'category']).describe("How to organize tabs: 'domain' groups by website domain, 'category' tries to group by common categories (social, work, shopping, etc.)"),
                collapseGroups: z.boolean().optional().default(false).describe("Whether to collapse the created groups."),
            }),
            examples: [
                { strategy: "domain", collapseGroups: false },
                { strategy: "category", collapseGroups: true }
            ],
            execute: async ({ strategy, collapseGroups }) => {
                const tabs = await chrome.tabs.query({ currentWindow: true });

                if (tabs.length === 0) {
                    return "No tabs to organize.";
                }

                // Prepare a JSON payload of tabs for the temporary model to analyze
                const tabsPayload = tabs.map(t => ({ id: t.id, title: t.title || '', url: t.url || '' }));

                // Use a temporary LanguageModelEx instance to propose groupings based on titles/urls
                let proposedGroups: Record<string, number[]> | null = null;

                try {
                    const llm = await LanguageModelEx.create({
                        initialPrompts: [
                            { role: 'system', content: 'You will receive a JSON array of browser tabs (id, title, url). Return a JSON object where keys are group names and values are arrays of tab ids that belong to that group. Keep group names short (one or two words). Only return valid JSON.' }
                        ],
                    });

                    // Craft prompt
                    const prompt = `Here are the open tabs:\n${JSON.stringify(tabsPayload, null, 2)}\n\nOrganize them into groups based on title and URL similarity. Output ONLY a JSON object with group names as keys and arrays of tab ids as values. Do not include any other text.`;

                    const responseConstraint = {
                        type: 'object',
                        patternProperties: {
                            '.*': { type: 'array', items: { type: 'number' } }
                        },
                        additionalProperties: false
                    } as any;

                    const response = await llm.prompt(prompt, { responseConstraint });

                    // Try parse JSON from response
                    try {
                        const parsed = JSON.parse(response);
                        // Validate structure (object with arrays of ids)
                        if (parsed && typeof parsed === 'object') {
                            const valid = Object.values(parsed).every((arr: any) => Array.isArray(arr));
                            if (valid) {
                                proposedGroups = parsed as Record<string, number[]>;
                            }
                        }
                    } catch (e) {
                        // ignore parse error -> fallback
                        console.warn('organizeTabsAutomatically: LLM returned non-JSON or unparsable output, falling back to heuristic grouping');
                    }

                    llm.destroy();
                } catch (e) {
                    console.warn('organizeTabsAutomatically: Failed to create or use LanguageModelEx, falling back to heuristic grouping', e);
                }

                const groups: Record<string, number[]> = {};

                if (proposedGroups) {
                    // Map proposedGroups keys to actual tab ids (ensure ids are numbers present in current tabs)
                    const availableIds = new Set(tabs.map(t => t.id));
                    for (const [groupName, ids] of Object.entries(proposedGroups)) {
                        const filteredIds = ids.filter((id: any) => availableIds.has(id));
                        if (filteredIds.length > 0) groups[groupName] = filteredIds as number[];
                    }
                } else {
                    // Fallback: previous heuristic grouping (domain or category)
                    if (strategy === 'domain') {
                        tabs.forEach(tab => {
                            if (!tab.url || !tab.id) return;
                            try {
                                const url = new URL(tab.url);
                                const domain = url.hostname.replace('www.', '');
                                if (!groups[domain]) groups[domain] = [];
                                groups[domain].push(tab.id);
                            } catch (e) {
                                // Skip invalid URLs
                            }
                        });
                    } else {
                        const categories: Record<string, string[]> = {
                            'Social Media': ['facebook', 'twitter', 'instagram', 'linkedin', 'reddit', 'tiktok', 'pinterest'],
                            'Work': ['slack', 'notion', 'asana', 'trello', 'jira', 'zoom', 'teams'],
                            'Email': ['gmail', 'outlook', 'mail.google', 'mail.yahoo'],
                            'Shopping': ['amazon', 'ebay', 'shop', 'store', 'buy'],
                            'Entertainment': ['youtube', 'netflix', 'spotify', 'twitch', 'disney'],
                            'Development': ['github', 'stackoverflow', 'gitlab', 'codepen', 'dev.to'],
                            'Documentation': ['docs', 'documentation', 'developer', 'api', 'guide'],
                            'Google': ['google.com'],
                        };

                        tabs.forEach(tab => {
                            if (!tab.url || !tab.id) return;
                            const url = tab.url.toLowerCase();
                            let matched = false;

                            for (const [category, keywords] of Object.entries(categories)) {
                                if (keywords.some(keyword => url.includes(keyword))) {
                                    if (!groups[category]) groups[category] = [];
                                    groups[category].push(tab.id);
                                    matched = true;
                                    break;
                                }
                            }

                            if (!matched) {
                                if (!groups['Other']) groups['Other'] = [];
                                groups['Other'].push(tab.id);
                            }
                        });
                    }
                }

                // Create groups (only for groups with 2+ tabs)
                const colors: Array<'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange'> =
                    ['blue', 'green', 'purple', 'cyan', 'orange', 'pink', 'red', 'yellow'];
                let colorIndex = 0;
                let groupsCreated = 0;

                for (const [name, tabIds] of Object.entries(groups)) {
                    if (tabIds.length >= 2) {
                        // @ts-ignore
                        const groupId = await chrome.tabs.group({ tabIds });
                        // @ts-ignore
                        await chrome.tabGroups.update(groupId, {
                            title: name,
                            color: colors[colorIndex % colors.length],
                            collapsed: collapseGroups
                        });
                        colorIndex++;
                        groupsCreated++;
                    }
                }

                return `Organized ${tabs.length} tabs into ${groupsCreated} groups using ${proposedGroups ? 'LLM-suggested' : strategy} strategy.`;
            },
        }),

        getMostVisitedSites: createTool({
            name: "getMostVisitedSites",
            description: "Get the user's most visited sites (top sites). These are the sites shown on the new tab page.",
            inputSchema: z.object({}),
            examples: [],
            execute: async () => {
                const topSites = await chrome.topSites.get();
                
                if (topSites.length === 0) {
                    return "No top sites available.";
                }

                const summary = topSites.map((site, index) => ({
                    rank: index + 1,
                    title: site.title,
                    url: site.url,
                }));

                return JSON.stringify(summary, null, 2);
            },
        }),

        searchDownloads: createTool({
            name: "searchDownloads",
            description: "Search the user's download history. Can filter by filename, URL, date range, and more.",
            inputSchema: z.object({
                query: z.string().optional().describe("Search term to match against filenames and URLs."),
                maxResults: z.number().optional().default(20).describe("Maximum number of results to return."),
                state: z.enum(['in_progress', 'interrupted', 'complete']).optional().describe("Filter by download state."),
                startedAfter: z.string().optional().describe("Filter downloads started after this date (e.g., '24 hours ago', '7 days ago')."),
                orderBy: z.array(z.enum(['startTime', '-startTime', 'filename', '-filename'])).optional().describe("How to sort results. Prefix with - for descending order."),
            }),
            examples: [
                { query: "pdf", maxResults: 10 },
                { state: "complete", startedAfter: "7 days ago", maxResults: 20 },
                { query: "image", orderBy: ["-startTime"], maxResults: 15 }
            ],
            execute: async ({ query, maxResults, state, startedAfter, orderBy }) => {
                // Parse relative time strings
                let startedAfterMs: number | undefined;
                if (startedAfter) {
                    if (startedAfter.includes('ago')) {
                        const match = startedAfter.match(/(\d+)\s+(hour|day|week|month)s?\s+ago/i);
                        if (match) {
                            const value = parseInt(match[1]);
                            const unit = match[2].toLowerCase();
                            const now = Date.now();
                            const multipliers: Record<string, number> = {
                                'hour': 3600000,
                                'day': 86400000,
                                'week': 604800000,
                                'month': 2592000000
                            };
                            startedAfterMs = now - (value * multipliers[unit]);
                        }
                    } else {
                        startedAfterMs = new Date(startedAfter).getTime();
                    }
                }

                const searchQuery: any = {
                    limit: maxResults,
                };

                if (query) {
                    searchQuery.query = [query];
                }

                if (state) {
                    searchQuery.state = state;
                }

                if (startedAfterMs) {
                    searchQuery.startedAfter = new Date(startedAfterMs).toISOString();
                }

                if (orderBy) {
                    searchQuery.orderBy = orderBy;
                }

                const downloads = await chrome.downloads.search(searchQuery);

                if (downloads.length === 0) {
                    return "No downloads found matching your criteria.";
                }

                const summary = downloads.map(dl => ({
                    filename: dl.filename.split(/[/\\]/).pop(),
                    url: dl.url,
                    state: dl.state,
                    fileSize: dl.fileSize > 0 ? `${(dl.fileSize / 1024 / 1024).toFixed(2)} MB` : 'Unknown',
                    startTime: new Date(dl.startTime).toLocaleString(),
                    endTime: dl.endTime ? new Date(dl.endTime).toLocaleString() : 'In progress',
                    exists: dl.exists,
                }));

                return JSON.stringify(summary, null, 2);
            },
        }),

        openDownload: createTool({
            name: "openDownload",
            description: "Open a completed download file. Searches for the file by name and opens it.",
            inputSchema: z.object({
                filename: z.string().describe("The filename to search for and open."),
            }),
            examples: [
                { filename: "document.pdf" },
                { filename: "report" }
            ],
            execute: async ({ filename }) => {
                const downloads = await chrome.downloads.search({
                    query: [filename],
                    state: 'complete',
                    limit: 1,
                });

                if (downloads.length === 0) {
                    return `No completed download found matching "${filename}"`;
                }

                const download = downloads[0];

                if (!download.exists) {
                    return `File "${download.filename}" has been deleted from disk.`;
                }

                try {
                    await chrome.downloads.open(download.id);
                    return `Opened file: ${download.filename.split(/[/\\]/).pop()}`;
                } catch (error) {
                    return `Could not open file: ${error instanceof Error ? error.message : 'Unknown error'}`;
                }
            },
        }),

        showDownloadFolder: createTool({
            name: "showDownloadFolder",
            description: "Show a downloaded file in its folder, or show the default Downloads folder.",
            inputSchema: z.object({
                filename: z.string().optional().describe("The filename to locate. If not provided, shows the default Downloads folder."),
            }),
            examples: [
                { filename: "document.pdf" },
                {}
            ],
            execute: async ({ filename }) => {
                if (!filename) {
                    chrome.downloads.showDefaultFolder();
                    return "Opened the default Downloads folder.";
                }

                const downloads = await chrome.downloads.search({
                    query: [filename],
                    limit: 1,
                });

                if (downloads.length === 0) {
                    return `No download found matching "${filename}"`;
                }

                const download = downloads[0];
                chrome.downloads.show(download.id);
                return `Showing "${download.filename.split(/[/\\]/).pop()}" in folder.`;
            },
        }),

        // getCurrentTime: createTool({
        //     name: "getCurrentTime",
        //     description: `Get current date and time from user's system.`,
        //     inputSchema: z.object({}),
        //     async execute() {
        //         const currentTime = getLocalizedDateTimeString();
        //         console.log(`Getting current time ${currentTime}`);
        //         return currentTime;
        //     },
        //     examples: []
        // }),

        askUser: createTool({
            name: "askUser",
            description: `Ask the user a question and wait for their response. Use this when you need additional information from the user to complete their request.`,
            inputSchema: z.object({
                question: z.string().describe("The question to ask the user."),
                dataType: z.enum(["text", "image", "audio"]).describe("The type of data you're asking for."),
            }),
            async execute(args) {
                console.log(`Asking user: ${args.question}`);
                
                if (options?.onUserQuestion) {
                    return await options.onUserQuestion(args.question, args.dataType);
                }
                
                // Fallback: return a message indicating the feature needs implementation
                return `[User question: "${args.question}" - awaiting ${args.dataType} response]`;
            },
            examples: [
                {
                    question: "Which file would you like me to analyze?",
                    dataType: "text",
                },
                {
                    question: "Can you upload the image you want me to process?",
                    dataType: "image",
                }
            ]
        }),
    };
}
