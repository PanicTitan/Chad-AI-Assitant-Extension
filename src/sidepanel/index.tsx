import { useState, useEffect, createContext, useCallback, useMemo } from 'react';
import { Tabs, Spin, Badge } from 'antd';
import { 
    MessageOutlined, 
    SendOutlined, 
    FileTextOutlined, 
    EditOutlined, 
    SyncOutlined, 
    TranslationOutlined, 
    SettingOutlined,
    MonitorOutlined,
    ArrowLeftOutlined,
    ArrowRightOutlined
} from '@ant-design/icons';
import { UserPreferences } from '@/utils/UserPreferences';
import { getAppUrl } from '@/utils/vite-helper';
import InitialSetup from './components/InitialSetup';
import ChatTab from './components/ChatTab';
import PromptTab from './components/PromptTab';
import SummarizerTab from './components/SummarizerTab';
import WriterTab from './components/WriterTab';
import RewriterTab from './components/RewriterTab';
import TranslatorTab from './components/TranslatorTab';
import SettingsTab from './components/SettingsTab';
import styles from './index.module.css';

type TabKey = 'chat' | 'prompt' | 'summarizer' | 'writer' | 'rewriter' | 'translator' | 'supervisor' | 'settings';

// Context for tabs to signal when they're loading
export const TabLoadingContext = createContext<{
    setTabLoading: (tabKey: TabKey, loading: boolean) => void;
}>({
    setTabLoading: () => {},
});

export default function Sidepanel() {
    const [loading, setLoading] = useState(true);
    const [setupCompleted, setSetupCompleted] = useState(false);
    const [activeTab, setActiveTab] = useState<TabKey>('chat');
    const [tabLoadingStates, setTabLoadingStates] = useState<Record<string, boolean>>({});
    const [sidebarExpanded, setSidebarExpanded] = useState(false);

    // ALL HOOKS MUST BE BEFORE ANY CONDITIONAL RETURNS
    const setTabLoading = useCallback((tabKey: TabKey, loading: boolean) => {
        setTabLoadingStates(prev => ({
            ...prev,
            [tabKey]: loading
        }));
    }, []);

    const contextValue = useMemo(() => ({ setTabLoading }), [setTabLoading]);

    useEffect(() => {
        initializePreferences();
    }, []);

    const initializePreferences = async () => {
        try {
            const userPrefs = UserPreferences.getInstance();
            await userPrefs.initialize();
            setSetupCompleted(userPrefs.isSetupCompleted());
        } catch (error) {
            console.error('Failed to initialize preferences:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSetupComplete = () => {
        setSetupCompleted(true);
        setActiveTab('chat');
    };

    const handleTabChange = (key: string) => {
        if (key === 'supervisor') {
            // Open Supervisor in a new page
            chrome.tabs.create({
                url: getAppUrl('/src/index.html?path=supervisor'),
                pinned: true,
            });
            // Close the sidepanel
            window.close();
        } else {
            setActiveTab(key as TabKey);
        }
    };

    if (loading) {
        return (
            <div className={styles.loadingContainer}>
                <Spin size="large" />
            </div>
        );
    }

    if (!setupCompleted) {
        return <InitialSetup onComplete={handleSetupComplete} />;
    }

    const tabItems = [
        {
            key: 'chat',
            label: (
                <Badge dot={tabLoadingStates['chat'] && activeTab !== 'chat'} offset={[5, 0]}>
                    <span>
                        <MessageOutlined />
                        Chat
                    </span>
                </Badge>
            ),
            children: <ChatTab />,
        },
        {
            key: 'prompt',
            label: (
                <Badge dot={tabLoadingStates['prompt'] && activeTab !== 'prompt'} offset={[5, 0]}>
                    <span>
                        <SendOutlined />
                        Prompt
                    </span>
                </Badge>
            ),
            children: <PromptTab />,
        },
        {
            key: 'summarizer',
            label: (
                <Badge dot={tabLoadingStates['summarizer'] && activeTab !== 'summarizer'} offset={[5, 0]}>
                    <span>
                        <FileTextOutlined />
                        Summarize
                    </span>
                </Badge>
            ),
            children: <SummarizerTab />,
        },
        {
            key: 'writer',
            label: (
                <Badge dot={tabLoadingStates['writer'] && activeTab !== 'writer'} offset={[5, 0]}>
                    <span>
                        <EditOutlined />
                        Writer
                    </span>
                </Badge>
            ),
            children: <WriterTab />,
        },
        {
            key: 'rewriter',
            label: (
                <Badge dot={tabLoadingStates['rewriter'] && activeTab !== 'rewriter'} offset={[5, 0]}>
                    <span>
                        <SyncOutlined />
                        Rewriter
                    </span>
                </Badge>
            ),
            children: <RewriterTab />,
        },
        {
            key: 'translator',
            label: (
                <Badge dot={tabLoadingStates['translator'] && activeTab !== 'translator'} offset={[5, 0]}>
                    <span>
                        <TranslationOutlined />
                        Translator
                    </span>
                </Badge>
            ),
            children: <TranslatorTab />,
        },
        {
            key: 'supervisor',
            label: (
                <span>
                    <MonitorOutlined />
                    Supervisor
                </span>
            ),
            children: <div />, // Empty div since this tab opens a new page
        },
        {
            key: 'settings',
            label: (
                <span>
                    <SettingOutlined />
                    Settings
                </span>
            ),
            children: <SettingsTab />,
        },
    ];

    return (
        <TabLoadingContext.Provider value={contextValue}>
            <div className={styles.sidepanelContainer}>
                <Tabs
                    activeKey={activeTab}
                    onChange={handleTabChange}
                    items={tabItems}
                    tabPosition="left"
                    className={`${styles.tabs} ${sidebarExpanded ? styles.expanded : ''}`}
                    type="card"
                />
                {sidebarExpanded ? (
                    <ArrowLeftOutlined  
                        className={styles.toggleContainer}
                        onClick={() => setSidebarExpanded(false)}
                    />
                ) : (
                    <ArrowRightOutlined  
                        className={styles.toggleContainer}
                        onClick={() => setSidebarExpanded(true)}
                    />
                )}
            </div>
        </TabLoadingContext.Provider>
    );
}
