import React from 'react';
import { useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';

/**
 * Premium Navigation Progress Bar
 * Shows a smooth progress animation during page transitions
 */
const NavigationProgress: React.FC = () => {
    const location = useLocation();
    const [isNavigating, setIsNavigating] = useState(false);
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        // Start progress animation
        setIsNavigating(true);
        setProgress(0);

        // Animate progress quickly to 80%
        const step1 = setTimeout(() => setProgress(30), 50);
        const step2 = setTimeout(() => setProgress(60), 150);
        const step3 = setTimeout(() => setProgress(80), 300);

        // Complete and hide
        const complete = setTimeout(() => {
            setProgress(100);
            setTimeout(() => {
                setIsNavigating(false);
                setProgress(0);
            }, 200);
        }, 400);

        return () => {
            clearTimeout(step1);
            clearTimeout(step2);
            clearTimeout(step3);
            clearTimeout(complete);
        };
    }, [location.pathname]);

    if (!isNavigating && progress === 0) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-[9999] h-1 bg-transparent overflow-hidden">
            <div
                className="h-full bg-gradient-to-r from-ide-secondary-400 via-ide-secondary-500 to-ide-primary-500 transition-all duration-200 ease-out shadow-lg"
                style={{
                    width: `${progress}%`,
                    boxShadow: '0 0 10px rgba(39, 156, 56, 0.5), 0 0 20px rgba(39, 156, 56, 0.3)'
                }}
            />
        </div>
    );
};

export default NavigationProgress;
