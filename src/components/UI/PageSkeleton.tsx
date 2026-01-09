import React from 'react';

interface PageSkeletonProps {
    type?: 'default' | 'cards' | 'table' | 'wizard';
}

/**
 * Premium Page Skeleton
 * Shows immediately while page content loads
 */
const PageSkeleton: React.FC<PageSkeletonProps> = ({ type = 'default' }) => {
    const shimmerClass = "animate-pulse bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 rounded";

    if (type === 'wizard') {
        return (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Wizard Header Skeleton */}
                <div className="mb-8">
                    <div className={`h-8 w-64 ${shimmerClass} mb-3`} />
                    <div className={`h-4 w-96 ${shimmerClass}`} />
                </div>

                {/* Wizard Steps Skeleton */}
                <div className="flex space-x-4 mb-8">
                    {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className={`h-12 w-32 ${shimmerClass}`} />
                    ))}
                </div>

                {/* Content Area */}
                <div className={`h-96 w-full ${shimmerClass}`} />
            </div>
        );
    }

    if (type === 'cards') {
        return (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Header Skeleton */}
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <div className={`h-8 w-48 ${shimmerClass} mb-2`} />
                        <div className={`h-4 w-32 ${shimmerClass}`} />
                    </div>
                    <div className={`h-10 w-32 ${shimmerClass}`} />
                </div>

                {/* Cards Grid Skeleton */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                        <div key={i} className="bg-white rounded-xl border border-gray-200 p-6">
                            <div className={`h-12 w-12 ${shimmerClass} mb-4`} />
                            <div className={`h-5 w-3/4 ${shimmerClass} mb-2`} />
                            <div className={`h-4 w-full ${shimmerClass} mb-4`} />
                            <div className={`h-4 w-1/2 ${shimmerClass}`} />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (type === 'table') {
        return (
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Header Skeleton */}
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <div className={`h-8 w-48 ${shimmerClass} mb-2`} />
                        <div className={`h-4 w-64 ${shimmerClass}`} />
                    </div>
                    <div className={`h-10 w-32 ${shimmerClass}`} />
                </div>

                {/* Table Skeleton */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    {/* Table Header */}
                    <div className="bg-gray-50 px-6 py-4 flex space-x-6">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className={`h-4 w-24 ${shimmerClass}`} />
                        ))}
                    </div>

                    {/* Table Rows */}
                    {[1, 2, 3, 4, 5, 6].map((row) => (
                        <div key={row} className="px-6 py-4 flex space-x-6 border-t border-gray-100">
                            {[1, 2, 3, 4, 5].map((col) => (
                                <div key={col} className={`h-4 w-24 ${shimmerClass}`} />
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // Default skeleton
    return (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {/* Header Skeleton */}
            <div className="mb-8">
                <div className={`h-10 w-72 ${shimmerClass} mb-3`} />
                <div className={`h-5 w-96 ${shimmerClass}`} />
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="bg-white rounded-xl p-6 border border-gray-200">
                        <div className={`h-8 w-8 ${shimmerClass} mb-4`} />
                        <div className={`h-6 w-16 ${shimmerClass} mb-2`} />
                        <div className={`h-4 w-24 ${shimmerClass}`} />
                    </div>
                ))}
            </div>

            {/* Main Content */}
            <div className={`h-64 w-full ${shimmerClass}`} />
        </div>
    );
};

export default PageSkeleton;
