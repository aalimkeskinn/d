/**
 * WizardHeader Component
 * Wizard başlık barı - Logo, başlık ve aksiyonlar
 */

import React from 'react';
import { Zap, Save } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Button from '../UI/Button';

interface WizardHeaderProps {
    title: string;
    stepInfo: string;
    isEditing: boolean;
    isSaving: boolean;
    canSaveTemplate: boolean;
    onSaveTemplate: () => void;
}

const WizardHeader: React.FC<WizardHeaderProps> = ({
    stepInfo,
    isEditing,
    isSaving,
    canSaveTemplate,
    onSaveTemplate
}) => {
    const navigate = useNavigate();

    return (
        <div className="bg-white shadow-sm border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <div className="flex items-center">
                        <Zap className="w-8 h-8 text-blue-600 mr-3" />
                        <div>
                            <h1 className="text-xl font-semibold text-gray-900">
                                {isEditing ? 'Program Düzenleme' : 'Program Oluşturma Sihirbazı'}
                            </h1>
                            <p className="text-sm text-gray-600">{stepInfo}</p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-3">
                        <Button
                            onClick={onSaveTemplate}
                            icon={Save}
                            variant="secondary"
                            disabled={isSaving || !canSaveTemplate}
                        >
                            {isSaving ? 'Kaydediliyor...' : 'Şablonu Kaydet'}
                        </Button>
                        <Button onClick={() => navigate('/')} variant="secondary">
                            İptal
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default WizardHeader;
