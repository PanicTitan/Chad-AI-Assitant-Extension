'use client';
// motion/react is the new package for framer-motion's React features
import { motion, type HTMLMotionProps } from 'motion/react';

// Import the locally scoped styles
import styles from './index.module.css';

// The type definition remains the same, providing great type safety
export type GradientBackgroundProps = HTMLMotionProps<'div'> & {
    /**
     * Color scheme to use for the animated gradient.
     * - 'ref' (default): matches the reference pastel gradient
     * - 'pink': mascot 1 (pink/purple)
     * - 'yellow': mascot 2 (yellow/navy)
     * - 'blue': mascot 3 (blue/orange)
     */
    scheme?: 'ref' | 'pink' | 'yellow' | 'blue';
};

/**
 * A component that renders an infinitely animating gradient background.
 * Uses CSS Modules for styling to prevent class name collisions.
 */
export function GradientBackground({
    className,
    transition = { duration: 15, ease: 'linear', repeat: Infinity },
    scheme = 'ref',
    ...props
}: GradientBackgroundProps) {
    // Combine the local CSS module class with any external class passed via props
    const combinedClassName = `${styles.gradient} ${className || ''}`.trim();

    return (
        <motion.div
            data-slot="gradient-background"
            className={combinedClassName}
            // The animation logic is handled by framer-motion and is unchanged
            animate={{ backgroundPosition: ['0% 50%', '100% 50%', '0% 50%'] }}
            // Apply the gradient as an inline style so it can be switched via the `scheme` prop.
            style={{ backgroundImage: getGradientForScheme(scheme) }}
            transition={transition}
            {...props}
        />
    );
}

/** Return a CSS linear-gradient(...) string for the provided scheme */
function getGradientForScheme(scheme: NonNullable<GradientBackgroundProps['scheme']>) {
    switch (scheme) {
        case 'pink':
            // Mascot 1: pink / purple pastel
            return 'linear-gradient(135deg, #ffd6e8 0%, #eab4ff 45%, #b9a6ff 100%)';
        case 'yellow':
            // Mascot 2: warm yellow with navy accents
            return 'linear-gradient(135deg, #fff4cc 0%, #ffd77a 50%, #ffe9b5 100%)';
        case 'blue':
            // Mascot 3: blue + orange accent
            return 'linear-gradient(135deg, #d6ecff 0%, #7db8ff 50%, #ffd38a 100%)';
        case 'ref':
        default:
            // Reference: soft pastel multi-stop (keeps original visual intention)
            return 'linear-gradient(135deg, #d1e3ff 0%, #d9fcea 45%, #ffcfe7 100%)';
    }
}
