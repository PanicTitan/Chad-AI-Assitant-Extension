import { logger } from "./logger";

/**
 * A highly configurable and efficient text splitter that guarantees chunks will not
 * exceed a specified token limit by using an async measurement function.
 */
export class TextSplitter {
    private measureFn: (text: string) => Promise<number>;
    private tokenLimit: number;

    /**
     * @param measureFn An async function that takes text and returns its token count.
     * @param tokenLimit The maximum token count allowed for a single chunk.
     */
    constructor(measureFn: (text: string) => Promise<number>, tokenLimit: number) {
        if (typeof measureFn !== 'function') throw new Error("measureFn must be a function.");
        this.measureFn = measureFn;
        this.tokenLimit = tokenLimit;
    }

    /**
     * Splits the text into the minimum number of balanced chunks that fit the token limit.
     * It iteratively tries splitting into 2, 3, 4... parts until a valid split is found.
     * This is the most reliable way to ensure no chunk overflows the quota.
     */
    public async split(text: string): Promise<string[]> {
        const totalUsage = await this.measureFn(text);
        if (totalUsage <= this.tokenLimit) {
            return [text];
        }

        const maxChunksToTry = 100; // Safety break for extremely large/dense texts
        for (let numChunks = 2; numChunks <= maxChunksToTry; numChunks++) {
            const chunks = this.trySplitIntoNChunks(text, numChunks);
            // Measure all chunks in parallel to see if this split is valid.
            const usages = await Promise.all(chunks.map(c => this.measureFn(c)));

            if (usages.every(usage => usage <= this.tokenLimit)) {
                logger.info(`Successfully split text into ${numChunks} balanced chunks.`);
                return chunks; // This is the first valid, most balanced split we found.
            }
        }

        throw new Error(`Could not split text into ${maxChunksToTry} chunks that fit the token limit. The text may be too large or contain an unbreakable sentence.`);
    }

    /**
     * A helper method to perform a balanced split of text into a specific number of chunks,
     * respecting sentence boundaries.
     */
    private trySplitIntoNChunks(text: string, numChunks: number): string[] {
        // Target character length for each chunk to achieve a balanced distribution.
        const targetLength = Math.ceil(text.length / numChunks);
        // A robust regex to split by sentences and various newline characters, keeping the delimiters.
        const sentences = text.match(/.*?[.!?\n\r]+|.+/g) ?? [];
        const chunks: string[] = [];
        let currentChunk = "";

        for (const sentence of sentences) {
            // If the current chunk is "full enough" and we are not yet working on the last chunk...
            if (currentChunk.length > targetLength && chunks.length < numChunks - 1) {
                // ...then we finalize the current chunk and start a new one.
                chunks.push(currentChunk);
                currentChunk = "";
            }
            currentChunk += sentence;
        }
        chunks.push(currentChunk); // Add the final chunk.
        return chunks;
    }
}
