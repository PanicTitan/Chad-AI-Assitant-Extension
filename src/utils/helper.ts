

export async function dataUrlToBlob(dataUrl: string) {
    const response = await fetch(dataUrl);

    const blob = await response.blob();

    return blob;
}

export async function blobToBase64(blob: Blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        // Event listener for when the reading is complete
        reader.onloadend = () => {
            // The result will be a data URL (e.g., data:image/png;base64,...)
            // We need to extract only the Base64 part after the comma
            resolve(reader.result!);
        };

        // Event listener for handling errors during reading
        reader.onerror = reject;

        // Read the Blob as a Data URL
        reader.readAsDataURL(blob);
    });
}

export function findByTextAndAttributes(rootElement: HTMLElement, text: string): HTMLElement[] {
    const walker = document.createTreeWalker(
        rootElement,
        NodeFilter.SHOW_ELEMENT,
        null,
        // false
    );

    const nodes: HTMLElement[] = [];
    let currentNode: HTMLElement | null;

    while ((currentNode = walker.nextNode() as HTMLElement | null)) {
        // Check element's direct text content
        const ownText = Array.from(currentNode.childNodes)
            .filter((node: ChildNode): node is Text => node.nodeType === document.TEXT_NODE)
            .map((node: Text) => node.nodeValue || '')
            .join('');

        if (ownText.includes(text)) {
            nodes.push(currentNode);
            continue;
        }

        // Check element's attributes
        if (currentNode.hasAttributes()) {
            const attrs = currentNode.attributes;
            for (let i = 0; i < attrs.length; i++) {
                if (attrs[i].value.includes(text)) {
                    nodes.push(currentNode);
                    break;
                }
            }
        }
    }

    return nodes;
}

/**
 * Returns a single string representing the locally formatted date and time.
 *
 * @param {Date} [date=new Date()] - The date to format. Defaults to now.
 * @returns {string} The formatted date and time string.
 */
export function getLocalizedDateTimeString(date = new Date()) {
    // Define options for formatting
    const options: Intl.DateTimeFormatOptions = {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    };

    // 'undefined' uses the default locale, options specifies the format.
    return date.toLocaleString(undefined, options);
}
