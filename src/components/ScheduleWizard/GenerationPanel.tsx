/**
 * GenerationPanel Component
 * Program oluşturma aşamasının UI'ını render eder
 */

import React from 'react';
import {
    Users,
    Trash2,
    Loader,
    CheckCircle,
    Zap,
    Save,
    StopCircle,
    Edit3
} from 'lucide-react';
import Button from '../UI/Button';
import ManualScheduleEditor from '../Wizard/ManualScheduleEditor';
import { Teacher, Class, Subject, Schedule } from '../../types/index';
import { EnhancedGenerationResult } from '../../types/wizard';

export type GenerationPhase = 'initial' | 'generating' | 'club_pre_assigned' | 'club_saved' | 'completed' | 'manual_editing';

interface GenerationPanelProps {
    // State
    generationPhase: GenerationPhase;
    generationResult: EnhancedGenerationResult | null;
    isGenerating: boolean;
    isSaving: boolean;
    optimizationProgress: number;
    existingSchedules: Schedule[];

    // Data
    classes: Class[];
    teachers: Teacher[];
    subjects: Subject[];
    totalLessons: number;

    // Handlers
    onPreAssignClubs: () => void;
    onSaveClubs: () => void;
    onAssignRemaining: () => void;
    onSaveAndExit: () => void;
    onStopOptimization: () => void;
    onManualEdit: () => void;
    onManualEditCancel: () => void;
    onManualEditSave: (updatedSchedules: Omit<Schedule, 'id' | 'createdAt'>[]) => Promise<void>;
    onDeleteAllSchedules: () => void;
}

const GenerationPanel: React.FC<GenerationPanelProps> = ({
    generationPhase,
    generationResult,
    isGenerating,
    isSaving,
    optimizationProgress,
    existingSchedules,
    classes,
    teachers,
    subjects,
    totalLessons: totalLessonsFromProps,
    onPreAssignClubs,
    onSaveClubs,
    onAssignRemaining,
    onSaveAndExit,
    onStopOptimization,
    onManualEdit,
    onManualEditCancel,
    onManualEditSave,
    onDeleteAllSchedules
}) => {
    const isLoading = isGenerating;
    const totalLessons = generationResult?.statistics.totalLessonsToPlace || totalLessonsFromProps || 0;
    const placedLessons = generationResult?.statistics.placedLessons || 0;
    const isPerfect = totalLessons > 0 && placedLessons === totalLessons;

    return (
        <div className="space-y-6 text-center">
            {/* Initial Phase */}
            {generationPhase === 'initial' && (
                <>
                    <Users className="w-12 h-12 text-ide-primary-600 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Program Hazırlığı</h2>
                    <p className="text-gray-600 max-w-lg mx-auto mb-6">
                        Önce kulüp derslerini atayarak programın temelini oluşturabilir veya doğrudan tüm programı oluşturabilirsiniz.
                    </p>
                    <div className="flex flex-col justify-center items-center space-y-4">
                        {existingSchedules.length > 0 ? (
                            <div className="pt-4 w-full max-w-md mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <div className="bg-red-50 border border-red-100 rounded-lg p-6 text-center">
                                    <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <Trash2 className="w-6 h-6 text-red-600" />
                                    </div>
                                    <h3 className="text-lg font-bold text-gray-900 mb-2">Mevcut Program Bulundu</h3>
                                    <p className="text-sm text-red-600 mb-6">
                                        Yeni bir program oluşturmadan önce mevcut ders programlarını temizlemeniz gerekmektedir.
                                        <br />
                                        <span className="font-bold">Bu işlem geri alınamaz!</span>
                                    </p>
                                    <button
                                        onClick={onDeleteAllSchedules}
                                        className="w-full inline-flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 shadow-sm transition-all hover:shadow-md"
                                    >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Mevcut Tüm Programları Temizle
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col sm:flex-row justify-center items-center space-y-3 sm:space-y-0 sm:space-x-4 animate-in fade-in zoom-in-95 duration-500">
                                <Button onClick={onPreAssignClubs} icon={Users} size="lg" variant="secondary" className="border-ide-primary-200 text-ide-primary-700 bg-ide-primary-50 hover:bg-ide-primary-100" disabled={isLoading}>
                                    Kulüp Dersleri Ata
                                </Button>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* Club Pre-Assigned Phase */}
            {generationPhase === 'club_pre_assigned' && generationResult && (
                <>
                    <CheckCircle className="w-12 h-12 text-ide-primary-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Kulüp Dersleri Hazır!</h2>
                    <p className="text-gray-600 mb-6 font-medium text-lg">
                        Kulüp dersleri başarıyla yerleştirildi. Devam etmek için lütfen aşağıdaki butona tıklayarak yerleşimi kaydedin.
                    </p>

                    <div className="flex justify-center items-center space-x-8 my-6">
                        <div className="text-center">
                            <p className="text-4xl font-bold text-ide-primary-600">{generationResult.statistics.placedLessons}</p>
                            <p className="text-sm text-gray-500">Yerleşen Kulüp</p>
                        </div>
                    </div>

                    <div className="mt-8 flex flex-col sm:flex-row justify-center items-center space-y-3 sm:space-y-0 sm:space-x-4">
                        <Button onClick={onSaveClubs} icon={Save} size="lg" variant="primary" disabled={isLoading} className="w-full sm:w-auto px-8">
                            Kulüpleri Kaydet ve Devam Et
                        </Button>
                    </div>
                </>
            )}

            {/* Club Saved Phase */}
            {generationPhase === 'club_saved' && (
                <>
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">Kulüpler Kaydedildi!</h2>
                    <p className="text-gray-600 mb-6">Kulüp dersleri başarıyla kaydedildi. Şimdi kalan dersleri atayabilirsiniz.</p>
                    <div className="flex justify-center items-center space-x-3">
                        <Button
                            onClick={onAssignRemaining}
                            variant="primary"
                            className="flex-1"
                            disabled={isLoading}
                        >
                            Kalan Dersleri Ata
                        </Button>
                    </div>
                </>
            )}

            {/* Loading Phase */}
            {isLoading && (
                <>
                    <Loader className="w-12 h-12 text-blue-600 mx-auto mb-4 animate-spin" />
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">
                        Program Oluşturuluyor...
                    </h2>
                    <p className="text-gray-600 max-w-lg mx-auto mb-8">
                        Mükemmel dağılım için hesaplamalar yapılıyor. Lütfen bekleyin.
                    </p>

                    <div className="w-full max-w-md mx-auto mb-6">
                        <div className="flex justify-between text-sm font-medium text-gray-700 mb-2">
                            <span>İlerleme</span>
                            <span>%{optimizationProgress}</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">
                            <div
                                className="bg-blue-600 h-4 rounded-full transition-all duration-300 ease-out flex items-center justify-center"
                                style={{ width: `${optimizationProgress}%` }}
                            >
                                <div className="w-full h-full bg-white/20 animate-smooth-pulse" />
                            </div>
                        </div>
                        <div className="text-center mt-2 text-xs text-gray-500">
                            Bu işlem birkaç dakika sürebilir...
                        </div>
                    </div>
                    <div className="mt-6">
                        <Button onClick={onStopOptimization} icon={StopCircle} size="md" variant="danger">
                            Durdur
                        </Button>
                    </div>
                </>
            )}

            {/* Completed Phase */}
            {generationPhase === 'completed' && generationResult && (
                <>
                    {isPerfect ? <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" /> : <Zap className="w-12 h-12 text-blue-500 mx-auto mb-4" />}
                    <h2 className="text-2xl font-bold text-gray-900 mb-2">
                        {isPerfect ? 'Mükemmel Çözüm Bulundu!' : 'Program Hazır'}
                    </h2>
                    <div className="flex justify-center items-center space-x-4 my-4">
                        <div className="text-center">
                            <p className="text-4xl font-bold text-gray-800">{placedLessons}</p>
                            <p className="text-sm text-gray-500">Yerleştirilen Ders</p>
                        </div>
                        <div className="text-4xl font-light text-gray-300">/</div>
                        <div className="text-center">
                            <p className="text-4xl font-bold text-gray-800">{totalLessons}</p>
                            <p className="text-sm text-gray-500">Toplam Ders</p>
                        </div>
                    </div>

                    {!isPerfect && (
                        <div className="max-w-md mx-auto my-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <h4 className="font-semibold text-blue-800">Bilgi: Yerleşemeyen {generationResult.statistics.unassignedLessons.reduce((acc, curr) => acc + curr.missingHours, 0)} ders saati var.</h4>
                            <p className="text-xs text-blue-600 mt-1 mb-2">Programı bu haliyle kaydedip kalanları manuel düzenleyebilirsiniz.</p>
                            <ul className="text-left text-xs text-blue-700 mt-2 list-disc list-inside max-h-32 overflow-y-auto">
                                {generationResult.statistics.unassignedLessons.map((item, index) => (
                                    <li key={index}>{item.className} - {item.subjectName} ({item.teacherName}) - {item.missingHours} sa</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <div className="mt-8 space-y-3 sm:space-y-0 sm:flex sm:justify-center sm:space-x-4">
                        <Button onClick={onManualEdit} icon={Edit3} size="lg" variant="secondary">
                            Son Kontrol ve Düzenleme
                        </Button>
                        <Button onClick={onSaveAndExit} icon={Save} size="lg" variant="primary" disabled={isSaving}>
                            {isSaving ? 'Kaydediliyor...' : `Programı Kaydet ve Bitir`}
                        </Button>
                    </div>
                </>
            )}

            {/* Manual Editing Phase */}
            {generationPhase === 'manual_editing' && generationResult && (
                <ManualScheduleEditor
                    generationResult={generationResult}
                    classes={classes}
                    teachers={teachers}
                    subjects={subjects}
                    onSave={onManualEditSave}
                    onCancel={onManualEditCancel}
                />
            )}
        </div>
    );
};

export default GenerationPanel;
