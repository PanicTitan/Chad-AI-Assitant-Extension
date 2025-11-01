import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
    manifest_version: 3,
    name: "Chad", // pkg.name,
    version: pkg.version,
    icons: {
        48: 'public/logo.png',
    },
    action: {
        default_icon: {
            48: 'public/icon.png',
        },
        default_popup: 'src/index.html?path=popup',
    },
    side_panel: {
        default_path: 'src/index.html?path=sidepanel',
    },
    omnibox: {
        keyword: "chad"
    },
    commands: {
        "open-sidepanel": {
            suggested_key: {
                default: "Ctrl+Q",
                mac: "Command+Q"
            },
            description: "Open AI assistant side panel"
        }
    },
    permissions: [
        "sidePanel",
        "contentSettings",
        "activeTab",
        "scripting",
        "tabs",
        "contextMenus",
        "history",
        "readingList",
        "storage",
        "notifications",
        "offscreen",
        "idle",
        "power",
        "alarms",
        "topSites",
        "downloads",
        "downloads.open"
    ],
    host_permissions: [
        "<all_urls>"
    ],
    content_scripts: [{
        js: ['src/content/main.tsx'],
        matches: [
            "https://*/*",
            "http://*/*"
        ],
        run_at: "document_start",

        // match_origin_as_fallback: true
    }],
    background: {
        service_worker: "src/background/main.ts",
        type: "module",
    },
    content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
    },
    // @ts-ignore
    trial_tokens: [
        // Prompt API (Dev)
        "AtUfZIQzCofbHkSckKG3+28VzI5QKSMw0cs7iVSR3blR/cs8ABQQ0bt7RbbxxIeLdUqEajFDi3hPJLFnfwr/8AAAAAB7eyJvcmlnaW4iOiJjaHJvbWUtZXh0ZW5zaW9uOi8vZGxuYWppZ3BraWdlcG1sbmJpYWxobG9lZGJvaWtsZmIiLCJmZWF0dXJlIjoiQUlQcm9tcHRBUElNdWx0aW1vZGFsSW5wdXQiLCJleHBpcnkiOjE3NzQzMTA0MDB9",
        // Prompt API for Chrome Extensions (Dev)
        "AjgyzdEJKP2t34EBqpqDchWyzP9qlPzxc9aqy6r8juLEmorCHEMXaMCyWnP0x8gt17T7Sd2Nr17CKK4sjgzf8Q4AAAB4eyJvcmlnaW4iOiJjaHJvbWUtZXh0ZW5zaW9uOi8vZGxuYWppZ3BraWdlcG1sbmJpYWxobG9lZGJvaWtsZmIiLCJmZWF0dXJlIjoiQUlQcm9tcHRBUElGb3JFeHRlbnNpb24iLCJleHBpcnkiOjE3NjA0ODYzOTl9",
        // Proofreader API (Dev)
        "AhljtD/F0HmDeqxNDdkM43IFqb4vBh9E18DtD/SlguB5ClzRJuYPpf75Diqfl+PmxpptV4+Cw7S1ZV5OaUmDxQ0AAABxeyJvcmlnaW4iOiJjaHJvbWUtZXh0ZW5zaW9uOi8vZGxuYWppZ3BraWdlcG1sbmJpYWxobG9lZGJvaWtsZmIiLCJmZWF0dXJlIjoiQUlQcm9vZnJlYWRlckFQSSIsImV4cGlyeSI6MTc3OTE0ODgwMH0=",
        // Rewriter API (Dev)
        "Aih+QNQ8BXfy6rA2zkaXOBti0tfegqACrY3nCrnrmZ/Eg+Y+zlA6pLuNM/E03XlzT+WTwZtMsNW9WtvY0cdg9w8AAABueyJvcmlnaW4iOiJjaHJvbWUtZXh0ZW5zaW9uOi8vZGxuYWppZ3BraWdlcG1sbmJpYWxobG9lZGJvaWtsZmIiLCJmZWF0dXJlIjoiQUlSZXdyaXRlckFQSSIsImV4cGlyeSI6MTc2OTQ3MjAwMH0=",
        // Writer API (Dev)
        "AtKTWRNGvkRkOi88X1yqmYbJAbFaUHxFq1MMYFCnwZD6tiIRuV57nC2Y5OUi30ZvZnAYHQ+fEIfR5fojoGkmggcAAABseyJvcmlnaW4iOiJjaHJvbWUtZXh0ZW5zaW9uOi8vZGxuYWppZ3BraWdlcG1sbmJpYWxobG9lZGJvaWtsZmIiLCJmZWF0dXJlIjoiQUlXcml0ZXJBUEkiLCJleHBpcnkiOjE3Njk0NzIwMDB9",
        // Prompt API (Prod)
        'Ak4TDOzrgfRt2rMID524XV/nISoP0529vPo+tHQFXxlAvaYY3c2PTFA0iqS9Ckcy2/rAURHrg6lKhntnw4XP3wkAAAB7eyJvcmlnaW4iOiJjaHJvbWUtZXh0ZW5zaW9uOi8vbGdrbmhwaGhjcGVtZWdnY2JpZWFhcG1pbWdubm1wZ2EiLCJmZWF0dXJlIjoiQUlQcm9tcHRBUElNdWx0aW1vZGFsSW5wdXQiLCJleHBpcnkiOjE3NzQzMTA0MDB9',
        // Proofreader API (Prod)
        'AnkDcVo07T0vULYG1P27BNT8FNp2MOW05Qv/xpp2EkNKB+CuYHMgBzoLc4ON4ZXUddnBsoTTAKTwlvSvqx/DtgsAAABxeyJvcmlnaW4iOiJjaHJvbWUtZXh0ZW5zaW9uOi8vbGdrbmhwaGhjcGVtZWdnY2JpZWFhcG1pbWdubm1wZ2EiLCJmZWF0dXJlIjoiQUlQcm9vZnJlYWRlckFQSSIsImV4cGlyeSI6MTc3OTE0ODgwMH0=',
        // Rewriter API (Prod)
        'AtMLqGGin45U3ZQHjCn1UYAphpY9PmT83TK3UZHS+gBySG9D0TGZLW9oJuZlOtljb6OBNxAO6M8Jv04eklw2Gg0AAABueyJvcmlnaW4iOiJjaHJvbWUtZXh0ZW5zaW9uOi8vbGdrbmhwaGhjcGVtZWdnY2JpZWFhcG1pbWdubm1wZ2EiLCJmZWF0dXJlIjoiQUlSZXdyaXRlckFQSSIsImV4cGlyeSI6MTc3NjcyOTYwMH0=',
        // Writer API (Prod)
        'AniMXccUaveGBM9o/U6ecz5UDvW/udJrTa4k4RY4BvpHby7rITd2JHXjog/0Gjv+MNNnjM6icLCGFkZKpGdewQgAAABseyJvcmlnaW4iOiJjaHJvbWUtZXh0ZW5zaW9uOi8vbGdrbmhwaGhjcGVtZWdnY2JpZWFhcG1pbWdubm1wZ2EiLCJmZWF0dXJlIjoiQUlXcml0ZXJBUEkiLCJleHBpcnkiOjE3NzY3Mjk2MDB9'
    ],
    web_accessible_resources: [
        {
            matches: [
                "http://*/*",
                "https://*/*"
            ],
            resources: [
                "src/offscreen/index.html",
            ],
            use_dynamic_url: false
        }
    ]
})
