import { Routes, Route, useNavigate } from "react-router";
import { useEffect } from "react";
import Sidepanel from "./sidepanel";
import Popup from "./popup";
import Supervisor from "./supervisor";

export default function Router() {
    const navigate = useNavigate();

    useEffect(() => {
        try {
            const search = window.location.search || "";
            const params = new URLSearchParams(search);
            const path = params.get("path");
            if (path) {
                // navigate to the requested path (replace history)
                navigate(path, { replace: true });

                // remove the `path` param from the URL to avoid re-processing or bugs
                params.delete("path");
                const baseUrl = window.location.pathname + (params.toString() ? `?${params.toString()}` : '') + window.location.hash;
                // replaceState will not add a history entry
                window.history.replaceState({}, document.title, baseUrl);
            }
        } catch (e) {
            // ignore malformed URL or other errors
        }
        // run only once on mount
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (<>
        <Routes>
            <Route path="sidepanel" element={<Sidepanel />} />
            <Route path="popup" element={<Popup />} />
            <Route path="supervisor" element={<Supervisor />} />
        </Routes>
    </>);
}
