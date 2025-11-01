// DotsBackground.tsx

import React from 'react';
import { getTheme } from '@/utils';
import styles from './index.module.css';

interface DotBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
    theme?: 'light' | 'dark';
}

/**
 * A component that renders a responsive dot-pattern background
 * with a faded edge effect, controllable via a theme prop.
 */
export function DotsBackground({
    children,
    className,
    style,
    theme,
    ...props
}: DotBackgroundProps) {
    const combinedClassName = [styles.wrapper, className].filter(Boolean).join(' ');

    return (
        <div 
            className={combinedClassName} 
            data-theme={theme ?? getTheme()}
            style={style}
            {...props}
        >
            <div className={styles.dotPattern} />
            <div className={styles.gradientMask} />
            <div className={styles.contentContainer}>
                {children}
            </div>
        </div>
    );
}
