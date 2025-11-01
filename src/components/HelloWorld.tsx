import { getAppUrl } from '@/utils/vite-helper';
import { useState } from 'react'

export default function HelloWorld(props: { msg: string }) {
    const [count, setCount] = useState(0)

    return (
        <>
            <h1>{props.msg}</h1>

            <div className="card">
                <button type="button" onClick={() => {
                    setCount(count + 1);
                    const url = getAppUrl('/src/index.html?path=supervisor');
                    try {
                        chrome.tabs.create({
                            url,
                            pinned: true
                        });
                    } catch (e) {
                        // in environments without chrome.* (e.g., tests), fall back to opening in a new window
                        // eslint-disable-next-line no-console
                        console.warn('chrome.tabs.create failed, opening in a new window as fallback', e);
                        window.open(url, '_blank');
                    }
                }}>
                    count is
                    {' '}
                    {count}
                </button>
                <p>
                    Edit
                    <code>src/components/HelloWorld.tsx</code>
                    {' '}
                    to test HMR
                </p>
            </div>

            <p>
                Check out
                <a href="https://github.com/crxjs/create-crxjs" target="_blank" rel="noreferrer">create-crxjs</a>
                , the official starter
            </p>

            <p className="read-the-docs">
                Click on the Vite, React and CRXJS logos to learn more
            </p>
        </>
    )
}
