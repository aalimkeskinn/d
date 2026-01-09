/**
 * WizardSidebar Component
 * Wizard adımlarını gösteren sidebar navigasyon bileşeni
 */

import React from 'react';
import { Check, LucideIcon } from 'lucide-react';

interface WizardStep {
    id: string;
    title: string;
    description: string;
    icon: LucideIcon;
}

interface WizardSidebarProps {
    steps: WizardStep[];
    currentStepIndex: number;
    completedSteps: Set<number>;
    onStepClick: (index: number) => void;
}

const WizardSidebar: React.FC<WizardSidebarProps> = ({
    steps,
    currentStepIndex,
    completedSteps,
    onStepClick
}) => {
    return (
        <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sticky top-8">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Adımlar</h3>
                <div className="space-y-2">
                    {steps.map((step, index) => {
                        const Icon = step.icon;
                        const isCompleted = completedSteps.has(index);
                        const isCurrent = index === currentStepIndex;
                        const isAccessible = completedSteps.has(index) || isCurrent || (index > 0 && completedSteps.has(index - 1));

                        return (
                            <button
                                key={step.id}
                                onClick={() => onStepClick(index)}
                                disabled={!isAccessible}
                                className={`w-full text-left p-4 rounded-xl border-2 transition-all duration-300 transform hover:scale-[1.02] ${isCurrent
                                        ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-400 shadow-lg ring-2 ring-blue-200'
                                        : isCompleted
                                            ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-300 hover:border-green-400 shadow-md'
                                            : isAccessible
                                                ? 'bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300 shadow-sm'
                                                : 'bg-gray-50 border-gray-100 text-gray-400 cursor-not-allowed opacity-60'
                                    }`}
                            >
                                <div className="flex items-center space-x-4">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm transition-all ${isCurrent
                                            ? 'bg-gradient-to-r from-blue-500 to-indigo-500 shadow-lg'
                                            : isCompleted
                                                ? 'bg-gradient-to-r from-green-500 to-emerald-500 shadow-md'
                                                : isAccessible
                                                    ? 'bg-gradient-to-r from-gray-400 to-gray-500'
                                                    : 'bg-gray-300'
                                        }`}>
                                        {isCompleted ? <Check size={20} /> : <Icon size={20} />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`font-semibold text-sm ${isCurrent ? 'text-blue-700' : isCompleted ? 'text-green-700' : isAccessible ? 'text-gray-700' : 'text-gray-400'
                                            }`}>
                                            {step.title}
                                        </p>
                                        <p className={`text-xs mt-1 ${isCurrent ? 'text-blue-600' : isCompleted ? 'text-green-600' : isAccessible ? 'text-gray-500' : 'text-gray-400'
                                            }`}>
                                            {step.description}
                                        </p>
                                    </div>
                                    {isCurrent && <div className="w-2 h-2 bg-blue-500 rounded-full animate-smooth-pulse"></div>}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default WizardSidebar;
