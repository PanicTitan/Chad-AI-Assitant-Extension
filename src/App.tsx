import '@ant-design/v5-patch-for-react-19';
import { App as AndtApp, ConfigProvider, theme } from 'antd';
import { HashRouter } from "react-router";
import Router from './Router';
import { getTheme } from './utils';

export default function App() {
    return (<>
        <ConfigProvider
            theme={{
                algorithm: getTheme() == "dark" ? theme.darkAlgorithm : undefined,
            }}
        >
            <AndtApp>
                <HashRouter>
                    <Router />
                </HashRouter>
            </AndtApp>
        </ConfigProvider>
    </>);
}
