import React, { useState, useEffect, useMemo } from 'react';
import { GripVertical, Lightbulb, Undo2, RotateCcw, Save, AlertTriangle, CheckCircle, ChevronDown, X, ArrowRight, Users, Building, Trash2 } from 'lucide-react';
import { Class, Teacher, Subject, Schedule, DAYS, PERIODS, getTimeForPeriod, formatTimeRange } from '../../types/index';
import { EnhancedGenerationResult } from '../../types/wizard';
import ConfirmationModal from '../UI/ConfirmationModal';

interface UnassignedLesson {
    className: string;
    classId: string;
    subjectName: string;
    subjectId: string;
    teacherName: string;
    teacherId: string;
    missingHours: number;
}

interface ScheduleSlot {
    classId: string;
    subjectId: string;
    teacherId?: string;
    isFixed?: boolean;
}

interface ConflictSuggestion {
    message: string;
    alternatives: { day: string; period: string; label: string }[];
    pendingAction: {
        type: 'new' | 'move';
        lesson?: UnassignedLesson;
        source?: { day: string; period: string; classId: string };
        target: { day: string; period: string; classId: string };
    };
}

interface Props {
    generationResult: EnhancedGenerationResult;
    classes: Class[];
    teachers: Teacher[];
    subjects: Subject[];
    onSave: (updatedSchedules: Omit<Schedule, 'id' | 'createdAt'>[]) => void;
    onCancel: () => void;
}

const DAYS_SHORT: { [key: string]: string } = {
    'Pazartesi': 'Pzt',
    'Salı': 'Sal',
    'Çarşamba': 'Çar',
    'Perşembe': 'Per',
    'Cuma': 'Cum'
};

type ViewMode = 'class' | 'teacher';

const ManualScheduleEditor: React.FC<Props> = ({
    generationResult,
    classes,
    teachers,
    subjects,
    onSave,
    onCancel
}) => {
    const [localGrid, setLocalGrid] = useState<{ [classId: string]: { [day: string]: { [period: string]: ScheduleSlot | null } } }>({});
    const [selectedClassId, setSelectedClassId] = useState<string>('');
    const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
    const [viewMode, setViewMode] = useState<ViewMode>('class');
    const [unassignedLessons, setUnassignedLessons] = useState<UnassignedLesson[]>([]);
    const [draggedLesson, setDraggedLesson] = useState<UnassignedLesson | null>(null);
    const [draggedFromGrid, setDraggedFromGrid] = useState<{ day: string; period: string; classId: string } | null>(null);
    const [suggestedSlots, setSuggestedSlots] = useState<Set<string>>(new Set());
    const [history, setHistory] = useState<typeof localGrid[]>([]);
    const [showSuggestions, setShowSuggestions] = useState<string | null>(null);
    const [conflictSuggestion, setConflictSuggestion] = useState<ConflictSuggestion | null>(null);
    const [showSaveWarning, setShowSaveWarning] = useState(false);
    const [teacherSearchQuery, setTeacherSearchQuery] = useState(''); // YENİ: Öğretmen arama

    const selectedClass = classes.find(c => c.id === selectedClassId);

    useEffect(() => {
        if (teachers.length > 0 && selectedTeacherIds.length === 0) {
            setSelectedTeacherIds([teachers[0].id]);
        }
    }, [teachers]);

    // Check if period is fixed (lunch, breakfast etc)
    const isFixedPeriod = (period: string, classLevel?: string): { isFixed: boolean; label: string } => {
        if (period === 'prep') return { isFixed: true, label: classLevel === 'Ortaokul' ? 'HAZIRLIK' : 'KAHVALTI' };
        if ((classLevel === 'İlkokul' || classLevel === 'Anaokulu') && period === '5') return { isFixed: true, label: 'ÖĞLE YEMEĞİ' };
        if (classLevel === 'Ortaokul' && period === '6') return { isFixed: true, label: 'ÖĞLE YEMEĞİ' };
        if (period === 'afternoon-breakfast') return { isFixed: true, label: 'İKİNDİ KAHVALTISI' };
        return { isFixed: false, label: '' };
    };

    // Get time info for period
    const getTimeInfo = (period: string, level?: string) => {
        const timePeriod = getTimeForPeriod(period, level as any);
        if (timePeriod) return formatTimeRange(timePeriod.startTime, timePeriod.endTime);
        return `${period}. Ders`;
    };

    // Build teacher schedule - Exhaustive check for club lessons and regular lessons
    const getTeacherSchedule = (teacherId: string) => {
        const teacherSched: { [day: string]: { [period: string]: { classId: string; subjectId: string; subjectName?: string } | null } } = {};
        const teacher = teachers.find(t => t.id === teacherId);

        DAYS.forEach(day => {
            teacherSched[day] = {};
            PERIODS.forEach(period => {
                teacherSched[day][period] = null;
            });
        });

        // Helper to check if a subject or class is KULÜP related
        const isKulupEntity = (id: string) => id === 'KULÜP' || id.toLocaleLowerCase('tr-TR').includes('kulüp') || id.toLocaleLowerCase('tr-TR').includes('kulup') || id.includes('virtual-class');

        // Helper to check if a slot is valid for this teacher's club time
        const isValidClubSlot = (day: string, period: string, level?: string) => {
            if (day !== 'Perşembe') return false;
            if (level === 'Ortaokul') return period === '7' || period === '8';
            if (level === 'İlkokul' || level === 'Anaokulu') return period === '9' || period === '10';
            return false;
        };

        // 1. Get from generationResult.schedules (Official source)
        const genSchedule = generationResult?.schedules?.find(s => s.teacherId === teacherId);
        if (genSchedule?.schedule) {
            Object.entries(genSchedule.schedule).forEach(([day, periods]) => {
                if (teacherSched[day]) {
                    Object.entries(periods as any).forEach(([period, slot]: [string, any]) => {
                        if (slot?.classId) {
                            const isKulup = isKulupEntity(slot.classId) || isKulupEntity(slot.subjectId);

                            // If it's a club lesson, only show if it matches teacher's level hours
                            if (isKulup && !isValidClubSlot(day, period, teacher?.level)) {
                                return;
                            }

                            const subjectItem = subjects.find(s => s.id === slot.subjectId);
                            teacherSched[day][period] = {
                                classId: isKulup ? 'KULÜP' : slot.classId,
                                subjectId: slot.subjectId,
                                subjectName: isKulup ? 'KULÜP' : (subjectItem?.name || slot.subjectId)
                            };
                        }
                    });
                }
            });
        }

        // 2. Get from localGrid (Includes manual edits)
        Object.entries(localGrid).forEach(([classId, days]) => {
            Object.entries(days).forEach(([day, periods]) => {
                Object.entries(periods).forEach(([period, slot]) => {
                    if (!slot) return;
                    const isKulup = isKulupEntity(classId) || isKulupEntity(slot.subjectId);

                    // Filter club lessons by level
                    if (isKulup && !isValidClubSlot(day, period, teacher?.level)) {
                        return;
                    }

                    if (slot.teacherId === teacherId || (teacher?.isClubTeacher && isKulup)) {
                        if (teacherSched[day][period] && teacherSched[day][period]?.classId === (isKulup ? 'KULÜP' : classId)) return;
                        const subjectItem = subjects.find(s => s.id === slot.subjectId);
                        teacherSched[day][period] = {
                            classId: isKulup ? 'KULÜP' : classId,
                            subjectId: slot.subjectId,
                            subjectName: isKulup ? 'KULÜP' : (subjectItem?.name || slot.subjectId)
                        };
                    }
                });
            });
        });

        // 3. APPLY DETERMINISTIC RULES: Club teachers have fixed club hours
        if (teacher?.isClubTeacher) {
            const clubDay = 'Perşembe';
            if (teacher.level === 'İlkokul' || teacher.level === 'Anaokulu') {
                ['9', '10'].forEach(p => {
                    if (teacherSched[clubDay]) {
                        teacherSched[clubDay][p] = { classId: 'KULÜP', subjectId: 'auto-subject-kulup', subjectName: 'KULÜP' };
                    }
                });
            } else if (teacher.level === 'Ortaokul') {
                ['7', '8'].forEach(p => {
                    if (teacherSched[clubDay]) {
                        teacherSched[clubDay][p] = { classId: 'KULÜP', subjectId: 'auto-subject-kulup', subjectName: 'KULÜP' };
                    }
                });
            }
        }
        return teacherSched;
    };

    // Initialize local grid
    useEffect(() => {
        if (generationResult?.finalGrid) {
            const grid: typeof localGrid = {};
            Object.entries(generationResult.finalGrid).forEach(([classId, days]) => {
                grid[classId] = {};
                DAYS.forEach(day => {
                    grid[classId][day] = {};
                    PERIODS.forEach(period => {
                        const slot = (days as any)[day]?.[period];
                        if (slot && slot.subjectId) {
                            grid[classId][day][period] = {
                                classId: slot.classId || classId,
                                subjectId: slot.subjectId,
                                teacherId: slot.teacherId,
                                isFixed: slot.isFixed
                            };
                        } else {
                            grid[classId][day][period] = null;
                        }
                    });
                });
            });

            classes.forEach(c => {
                if (!grid[c.id]) {
                    grid[c.id] = {};
                    DAYS.forEach(day => {
                        grid[c.id][day] = {};
                        PERIODS.forEach(period => {
                            grid[c.id][day][period] = null;
                        });
                    });
                }
            });

            setLocalGrid(grid);
            if (classes.length > 0 && !selectedClassId) {
                setSelectedClassId(classes[0].id);
            }
            if (teachers.length > 0 && selectedTeacherIds.length === 0) {
                setSelectedTeacherIds([teachers[0].id]);
            }
        }
    }, [generationResult, classes, teachers]);

    // Initialize unassigned lessons
    useEffect(() => {
        if (generationResult?.statistics?.unassignedLessons) {
            const lessons: UnassignedLesson[] = generationResult.statistics.unassignedLessons.map(item => {
                const classItem = classes.find(c => c.name === item.className);
                const subjectItem = subjects.find(s => s.name === item.subjectName);
                const teacherItem = teachers.find(t => t.name === item.teacherName);
                return {
                    className: item.className,
                    classId: classItem?.id || '',
                    subjectName: item.subjectName,
                    subjectId: subjectItem?.id || '',
                    teacherName: item.teacherName,
                    teacherId: teacherItem?.id || '',
                    missingHours: item.missingHours
                };
            });
            setUnassignedLessons(lessons);
        }
    }, [generationResult, classes, subjects, teachers]);

    // Teacher availability
    const teacherAvailability = useMemo(() => {
        const availability = new Map<string, Set<string>>();
        Object.entries(localGrid).forEach(([_classId, days]) => {
            Object.entries(days).forEach(([day, periods]) => {
                Object.entries(periods).forEach(([period, slot]) => {
                    if (slot?.teacherId) {
                        const key = `${day}-${period}`;
                        if (!availability.has(slot.teacherId)) {
                            availability.set(slot.teacherId, new Set());
                        }
                        availability.get(slot.teacherId)!.add(key);
                    }
                });
            });
        });
        return availability;
    }, [localGrid]);

    // Calculate suggestions
    const calculateSuggestions = (lesson: UnassignedLesson): Set<string> => {
        const suggestions = new Set<string>();
        const teacherBusy = teacherAvailability.get(lesson.teacherId) || new Set();
        const classGrid = localGrid[lesson.classId];
        const classItem = classes.find(c => c.id === lesson.classId);
        if (!classGrid) return suggestions;

        DAYS.forEach(day => {
            PERIODS.forEach(period => {
                const fixed = isFixedPeriod(period, classItem?.level);
                if (fixed.isFixed) return;

                const key = `${day}-${period}`;
                const slot = classGrid[day]?.[period];
                if (!slot && !teacherBusy.has(key)) {
                    suggestions.add(key);
                }
            });
        });
        return suggestions;
    };

    // Find alternatives
    const findAlternatives = (teacherId: string, targetClassId: string): { day: string; period: string; label: string }[] => {
        const teacherBusy = teacherAvailability.get(teacherId) || new Set();
        const classGrid = localGrid[targetClassId];
        const classItem = classes.find(c => c.id === targetClassId);
        const alternatives: { day: string; period: string; label: string }[] = [];

        if (!classGrid) return alternatives;

        DAYS.forEach(day => {
            PERIODS.forEach(period => {
                const fixed = isFixedPeriod(period, classItem?.level);
                if (fixed.isFixed) return;

                const key = `${day}-${period}`;
                const slot = classGrid[day]?.[period];
                if (!slot && !teacherBusy.has(key)) {
                    alternatives.push({
                        day,
                        period,
                        label: `${DAYS_SHORT[day]} ${period}.`
                    });
                }
            });
        });

        return alternatives.slice(0, 5);
    };

    // Drag handlers
    const handleDragStart = (lesson: UnassignedLesson) => {
        setDraggedLesson(lesson);
        setDraggedFromGrid(null);
        setConflictSuggestion(null);
        setSuggestedSlots(calculateSuggestions(lesson));
    };

    const handleGridDragStart = (day: string, period: string, classId: string) => {
        setDraggedLesson(null);
        setDraggedFromGrid({ day, period, classId });
        setConflictSuggestion(null);
        setSuggestedSlots(new Set());
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const checkConflict = (teacherId: string, day: string, period: string, excludeClassId?: string): boolean => {
        for (const [classId, days] of Object.entries(localGrid)) {
            if (excludeClassId && classId === excludeClassId) continue;
            const slot = days[day]?.[period];
            if (slot?.teacherId === teacherId) return true;
        }
        return false;
    };

    const placeLesson = (targetDay: string, targetPeriod: string, targetClassId: string, lesson: UnassignedLesson) => {
        setLocalGrid(prev => ({
            ...prev,
            [targetClassId]: {
                ...prev[targetClassId],
                [targetDay]: {
                    ...prev[targetClassId]?.[targetDay],
                    [targetPeriod]: {
                        classId: targetClassId,
                        subjectId: lesson.subjectId,
                        teacherId: lesson.teacherId
                    }
                }
            }
        }));

        setUnassignedLessons(prev => {
            const updated = prev.map(l => {
                if (l.classId === lesson.classId && l.subjectId === lesson.subjectId && l.teacherId === lesson.teacherId) {
                    return { ...l, missingHours: l.missingHours - 1 };
                }
                return l;
            }).filter(l => l.missingHours > 0);
            return updated;
        });
    };

    const handleForcePlace = () => {
        if (!conflictSuggestion?.pendingAction) return;

        const { type, lesson, source, target } = conflictSuggestion.pendingAction;
        const targetSlot = localGrid[target.classId]?.[target.day]?.[target.period];

        // If target slot is occupied, move current lesson to unassigned
        if (targetSlot && !targetSlot.isFixed) {
            const classItem = classes.find(c => c.id === target.classId);
            const subjectItem = subjects.find(s => s.id === targetSlot.subjectId);
            const teacherItem = teachers.find(t => t.id === targetSlot.teacherId);

            if (classItem && subjectItem && teacherItem) {
                setUnassignedLessons(prev => {
                    const existingIndex = prev.findIndex(
                        l => l.classId === target.classId && l.subjectId === targetSlot.subjectId && l.teacherId === targetSlot.teacherId
                    );
                    if (existingIndex >= 0) {
                        const updated = [...prev];
                        updated[existingIndex] = { ...updated[existingIndex], missingHours: updated[existingIndex].missingHours + 1 };
                        return updated;
                    } else {
                        return [...prev, {
                            className: classItem.name,
                            classId: target.classId,
                            subjectName: subjectItem.name,
                            subjectId: targetSlot.subjectId,
                            teacherName: teacherItem.name,
                            teacherId: targetSlot.teacherId || '',
                            missingHours: 1
                        }];
                    }
                });
            }
        }

        if (type === 'new' && lesson) {
            setLocalGrid(prev => ({
                ...prev,
                [target.classId]: {
                    ...prev[target.classId],
                    [target.day]: {
                        ...prev[target.classId]?.[target.day],
                        [target.period]: {
                            classId: target.classId,
                            subjectId: lesson.subjectId,
                            teacherId: lesson.teacherId
                        }
                    }
                }
            }));

            setUnassignedLessons(prev => prev.map(l => {
                if (l.classId === lesson.classId && l.subjectId === lesson.subjectId && l.teacherId === lesson.teacherId) {
                    return { ...l, missingHours: l.missingHours - 1 };
                }
                return l;
            }).filter(l => l.missingHours > 0));

        } else if (type === 'move' && source) {
            const sourceSlot = localGrid[source.classId]?.[source.day]?.[source.period];
            if (sourceSlot) {
                setLocalGrid(prev => {
                    const newGrid = JSON.parse(JSON.stringify(prev));
                    newGrid[source.classId][source.day][source.period] = null;
                    newGrid[target.classId][target.day][target.period] = sourceSlot;
                    return newGrid;
                });
            }
        }

        setDraggedLesson(null);
        setDraggedFromGrid(null);
        setSuggestedSlots(new Set());
        setConflictSuggestion(null);
    };

    const handleDrop = (targetDay: string, targetPeriod: string, targetClassId: string) => {
        const classItem = classes.find(c => c.id === targetClassId);
        const fixed = isFixedPeriod(targetPeriod, classItem?.level);
        if (fixed.isFixed) {
            return; // Cannot drop on fixed periods
        }

        setHistory(prev => [...prev.slice(-9), JSON.parse(JSON.stringify(localGrid))]);

        if (draggedLesson) {
            const lesson = draggedLesson;

            if (checkConflict(lesson.teacherId, targetDay, targetPeriod)) {
                const alternatives = findAlternatives(lesson.teacherId, targetClassId);
                setConflictSuggestion({
                    message: `${lesson.teacherName} bu saatte başka sınıfta!`,
                    alternatives,
                    pendingAction: {
                        type: 'new',
                        lesson,
                        target: { day: targetDay, period: targetPeriod, classId: targetClassId }
                    }
                });
                return;
            }

            if (localGrid[targetClassId]?.[targetDay]?.[targetPeriod]) {
                const alternatives = findAlternatives(lesson.teacherId, targetClassId);
                setConflictSuggestion({
                    message: 'Bu slot dolu!',
                    alternatives,
                    pendingAction: {
                        type: 'new',
                        lesson,
                        target: { day: targetDay, period: targetPeriod, classId: targetClassId }
                    }
                });
                return;
            }

            placeLesson(targetDay, targetPeriod, targetClassId, lesson);
            setDraggedLesson(null);
            setSuggestedSlots(new Set());
            setConflictSuggestion(null);

        } else if (draggedFromGrid) {
            const source = draggedFromGrid;
            const sourceSlot = localGrid[source.classId]?.[source.day]?.[source.period];
            if (!sourceSlot) return;

            if (sourceSlot.teacherId && checkConflict(sourceSlot.teacherId, targetDay, targetPeriod, source.classId)) {
                setConflictSuggestion({
                    message: 'Öğretmen bu saatte başka sınıfta!',
                    alternatives: [],
                    pendingAction: {
                        type: 'move',
                        source,
                        target: { day: targetDay, period: targetPeriod, classId: targetClassId }
                    }
                });
                return;
            }

            const targetSlot = localGrid[targetClassId]?.[targetDay]?.[targetPeriod];
            if (targetSlot && !targetSlot.isFixed) {
                setLocalGrid(prev => {
                    const newGrid = JSON.parse(JSON.stringify(prev));
                    newGrid[source.classId][source.day][source.period] = targetSlot;
                    newGrid[targetClassId][targetDay][targetPeriod] = sourceSlot;
                    return newGrid;
                });
            } else if (!targetSlot) {
                setLocalGrid(prev => {
                    const newGrid = JSON.parse(JSON.stringify(prev));
                    newGrid[source.classId][source.day][source.period] = null;
                    newGrid[targetClassId][targetDay][targetPeriod] = sourceSlot;
                    return newGrid;
                });
            }

            setDraggedFromGrid(null);
            setSuggestedSlots(new Set());
            setConflictSuggestion(null);
        }
    };

    const handleRemoveSlot = (day: string, period: string, classId: string) => {
        const slot = localGrid[classId]?.[day]?.[period];
        if (!slot) return;

        setHistory(prev => [...prev.slice(-9), JSON.parse(JSON.stringify(localGrid))]);

        // Add removed lesson back to unassigned list
        const classItem = classes.find(c => c.id === classId);
        const subjectItem = subjects.find(s => s.id === slot.subjectId);
        const teacherItem = teachers.find(t => t.id === slot.teacherId);

        if (classItem && subjectItem && teacherItem) {
            setUnassignedLessons(prev => {
                const existingIndex = prev.findIndex(
                    l => l.classId === classId && l.subjectId === slot.subjectId && l.teacherId === slot.teacherId
                );
                if (existingIndex >= 0) {
                    // Increment existing entry
                    const updated = [...prev];
                    updated[existingIndex] = { ...updated[existingIndex], missingHours: updated[existingIndex].missingHours + 1 };
                    return updated;
                } else {
                    // Add new entry
                    return [...prev, {
                        className: classItem.name,
                        classId: classId,
                        subjectName: subjectItem.name,
                        subjectId: slot.subjectId,
                        teacherName: teacherItem.name,
                        teacherId: slot.teacherId || '',
                        missingHours: 1
                    }];
                }
            });
        }

        setLocalGrid(prev => {
            const newGrid = JSON.parse(JSON.stringify(prev));
            newGrid[classId][day][period] = null;
            return newGrid;
        });
    };

    const handleAlternativeClick = (day: string, period: string) => {
        if (draggedLesson) {
            setHistory(prev => [...prev.slice(-9), JSON.parse(JSON.stringify(localGrid))]);
            placeLesson(day, period, draggedLesson.classId, draggedLesson);
            setDraggedLesson(null);
            setSuggestedSlots(new Set());
            setConflictSuggestion(null);
        }
    };

    const handleUndo = () => {
        if (history.length > 0) {
            const prevState = history[history.length - 1];
            setLocalGrid(prevState);
            setHistory(prev => prev.slice(0, -1));
        }
    };

    const handleReset = () => {
        if (generationResult?.finalGrid) {
            const grid: typeof localGrid = {};
            Object.entries(generationResult.finalGrid).forEach(([classId, days]) => {
                grid[classId] = {};
                DAYS.forEach(day => {
                    grid[classId][day] = {};
                    PERIODS.forEach(period => {
                        const slot = (days as any)[day]?.[period];
                        grid[classId][day][period] = slot ? { ...slot } : null;
                    });
                });
            });
            setLocalGrid(grid);
            setHistory([]);

            if (generationResult.statistics?.unassignedLessons) {
                setUnassignedLessons(generationResult.statistics.unassignedLessons.map(item => {
                    const classItem = classes.find(c => c.name === item.className);
                    const subjectItem = subjects.find(s => s.name === item.subjectName);
                    const teacherItem = teachers.find(t => t.name === item.teacherName);
                    return {
                        className: item.className,
                        classId: classItem?.id || '',
                        subjectName: item.subjectName,
                        subjectId: subjectItem?.id || '',
                        teacherName: item.teacherName,
                        teacherId: teacherItem?.id || '',
                        missingHours: item.missingHours
                    };
                }));
            }
        }
    };

    const handleSave = () => {
        // Check for unassigned lessons and warn user
        if (unassignedLessons.length > 0) {
            setShowSaveWarning(true);
            return;
        }
        performSave();
    };

    const performSave = () => {
        setShowSaveWarning(false);
        const scheduleMap: { [teacherId: string]: Schedule['schedule'] } = {};

        // 1. Regular lessons from localGrid
        Object.entries(localGrid).forEach(([classId, days]) => {
            Object.entries(days).forEach(([day, periods]) => {
                Object.entries(periods).forEach(([period, slot]) => {
                    if (slot?.teacherId) {
                        const tId = slot.teacherId;
                        if (!scheduleMap[tId]) {
                            scheduleMap[tId] = {};
                            DAYS.forEach(d => {
                                scheduleMap[tId][d] = {};
                                PERIODS.forEach(p => scheduleMap[tId][d][p] = null);
                            });
                        }
                        scheduleMap[tId][day][period] = { classId, subjectId: slot.subjectId };
                    }
                });
            });
        });

        // 2. Inject deterministic club lessons for club teachers
        teachers.forEach(teacher => {
            if (teacher.isClubTeacher) {
                const tId = teacher.id;
                if (!scheduleMap[tId]) {
                    scheduleMap[tId] = {};
                    DAYS.forEach(d => {
                        scheduleMap[tId][d] = {};
                        PERIODS.forEach(p => scheduleMap[tId][d][p] = null);
                    });
                }

                const clubDay = 'Perşembe';
                if (teacher.level === 'İlkokul' || teacher.level === 'Anaokulu') {
                    ['9', '10'].forEach(p => {
                        if (scheduleMap[tId][clubDay]) {
                            // Ensure consistency with getTeacherSchedule preview
                            scheduleMap[tId][clubDay][p] = {
                                classId: 'KULÜP',
                                subjectId: 'auto-subject-kulup',
                                teacherId: tId,
                                subjectName: 'KULÜP'
                            } as any;
                        }
                    });
                } else if (teacher.level === 'Ortaokul') {
                    ['7', '8'].forEach(p => {
                        if (scheduleMap[tId][clubDay]) {
                            // Ensure consistency with getTeacherSchedule preview
                            scheduleMap[tId][clubDay][p] = {
                                classId: 'KULÜP',
                                subjectId: 'auto-subject-kulup',
                                teacherId: tId,
                                subjectName: 'KULÜP'
                            } as any;
                        }
                    });
                }
            }
        });

        const schedules: Omit<Schedule, 'id' | 'createdAt'>[] = Object.entries(scheduleMap).map(([teacherId, schedule]) => ({
            teacherId,
            schedule,
            updatedAt: new Date()
        }));
        onSave(schedules);
    };

    const getSubjectName = (subjectId: string) => subjects.find(s => s.id === subjectId)?.name || subjectId;
    const getTeacherName = (teacherId: string) => {
        // Handle KULÜP virtual teachers
        if (teacherId === 'KULÜP' || teacherId.includes('kulup-virtual-teacher') || teacherId.includes('generic-teacher-kulup')) {
            return 'KULÜP';
        }
        return teachers.find(t => t.id === teacherId)?.name || teacherId;
    };
    const getClassName = (classId: string) => classes.find(c => c.id === classId)?.name || classId;

    const handleShowSuggestions = (lessonKey: string) => {
        if (showSuggestions === lessonKey) {
            setShowSuggestions(null);
            setSuggestedSlots(new Set());
        } else {
            setShowSuggestions(lessonKey);
            const lesson = unassignedLessons.find(l => `${l.classId}-${l.subjectId}-${l.teacherId}` === lessonKey);
            if (lesson) {
                setSuggestedSlots(calculateSuggestions(lesson));
                setSelectedClassId(lesson.classId);
                setViewMode('class');
            }
        }
    };

    const totalUnassigned = unassignedLessons.reduce((sum, l) => sum + l.missingHours, 0);

    const calculateDailyHours = (classId: string, day: string) => {
        let count = 0;
        const classItem = classes.find(c => c.id === classId);
        PERIODS.forEach(period => {
            const fixed = isFixedPeriod(period, classItem?.level);
            if (!fixed.isFixed && localGrid[classId]?.[day]?.[period]) {
                count++;
            }
        });
        return count;
    };

    const renderScheduleGrid = (targetId: string, type: 'class' | 'teacher') => {
        const targetClass = type === 'class' ? classes.find(c => c.id === targetId) : undefined;
        const targetTeacher = type === 'teacher' ? teachers.find(t => t.id === targetId) : undefined;
        const currentSchedule = type === 'class' ? null : getTeacherSchedule(targetId);

        // Compact Mode Logic
        const isCompact = type === 'teacher' && selectedTeacherIds.length > 1;
        const isSuperCompact = type === 'teacher' && selectedTeacherIds.length > 2;

        // Dynamic styles based on compact mode
        const cellPadding = isSuperCompact ? 'px-0.5 py-0.5' : (isCompact ? 'px-1 py-1' : 'px-2 py-2');
        const textSize = isSuperCompact ? 'text-[9px]' : (isCompact ? 'text-[10px]' : 'text-xs');
        const headerTextSize = isSuperCompact ? 'text-[10px]' : (isCompact ? 'text-xs' : 'text-sm');
        const smallTextSize = isSuperCompact ? 'text-[8px]' : (isCompact ? 'text-[9px]' : 'text-xs');
        const colWidth = isCompact ? 'w-8' : 'w-20';
        const timeColWidth = isCompact ? 'w-10' : 'w-24';
        const iconSize = isSuperCompact ? 10 : (isCompact ? 12 : 14);

        const headerTitle = type === 'class'
            ? `📚 ${targetClass?.name || ''} Sınıfı`
            : `👨‍🏫 ${targetTeacher?.name || ''}`;

        // Calculate hours for teacher
        let totalHours = 0;
        if (type === 'teacher' && currentSchedule) {
            Object.values(currentSchedule).forEach(day =>
                Object.values(day).forEach(slot => { if (slot) totalHours++; })
            );
        }

        return (
            <div className={`bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden h-full flex flex-col ${type === 'teacher' ? 'w-full' : 'min-w-[800px]'}`}>
                {/* Grid Header */}
                <div className={`bg-gradient-to-r from-emerald-600 to-emerald-700 ${isCompact ? 'px-2 py-1.5' : 'px-4 py-2.5'} text-white flex justify-between items-center`}>
                    <span className={`font-semibold truncate ${headerTextSize}`}>{headerTitle}</span>
                    {type === 'teacher' && <span className={`bg-white/20 px-1.5 py-0.5 rounded ${smallTextSize}`}>{totalHours} ders</span>}
                </div>

                <div className="overflow-auto flex-1">
                    <table className="w-full border-collapse table-fixed">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className={`${cellPadding} text-center ${smallTextSize} font-semibold text-gray-700 border border-gray-200 ${colWidth}`}>Ders</th>
                                <th className={`${cellPadding} text-center ${smallTextSize} font-semibold text-gray-700 border border-gray-200 ${timeColWidth}`}>Saat</th>
                                {DAYS.map(day => (
                                    <th key={day} className={`${cellPadding} text-center ${smallTextSize} font-semibold text-gray-700 border border-gray-200`}>
                                        {isCompact ? day.slice(0, 3) : day}
                                        {type === 'class' && (
                                            <div className={`${smallTextSize} mt-0.5`}>
                                                <span className="bg-emerald-100 text-emerald-700 px-1 py-0 rounded-full">
                                                    {calculateDailyHours(targetId, day)}
                                                </span>
                                            </div>
                                        )}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {/* Prep Period */}
                            <tr className="bg-yellow-400">
                                <td className={`${cellPadding} bg-yellow-400 font-semibold text-gray-900 border border-gray-400 ${smallTextSize} text-center`}>
                                    {isCompact ? 'HZR' : (targetClass?.level === 'Ortaokul' ? 'HAZIRLIK' : 'KAHVALTI')}
                                </td>
                                <td className={`${cellPadding} font-medium text-gray-900 border border-gray-400 ${smallTextSize} text-center whitespace-nowrap`}>
                                    {isCompact ? '08:30' : (targetClass?.level === 'Ortaokul' ? '08:30-08:40' : '08:30-08:50')}
                                </td>
                                <td colSpan={5} className={`${cellPadding} font-semibold text-gray-900 border border-gray-400 ${textSize} text-center`}>
                                    {isCompact ? 'HAZIRLIK' : (targetClass?.level === 'Ortaokul' ? 'HAZIRLIK' : 'KAHVALTI / breakfast')}
                                </td>
                            </tr>

                            {PERIODS.map(period => {
                                // Yemek saati: Öğretmen görünümünde 6. ders (ortaokul standardı)
                                // Sınıf görünümünde seviyeye göre belirlenir
                                const isLunchPeriod = type === 'teacher'
                                    ? period === '6'  // Öğretmen görünümünde 6. ders yemek (ortaokul standardı)
                                    : (
                                        ((targetClass?.level === 'İlkokul' || targetClass?.level === 'Anaokulu') && period === '5') ||
                                        (targetClass?.level === 'Ortaokul' && period === '6')
                                    );
                                const showAfternoonBreakAfter = period === '8';

                                return (
                                    <React.Fragment key={period}>
                                        <tr className={isLunchPeriod ? 'bg-yellow-400' : ''}>
                                            <td className={`${cellPadding} font-semibold text-gray-900 ${smallTextSize} text-center border border-gray-300 ${isLunchPeriod ? 'bg-yellow-400' : 'bg-gray-50'}`}>
                                                {isLunchPeriod ? (isCompact ? 'YMK' : 'YEMEK') : period}
                                            </td>
                                            <td className={`${cellPadding} font-medium text-gray-900 ${smallTextSize} text-center border border-gray-300 whitespace-nowrap ${isLunchPeriod ? 'bg-yellow-400' : 'bg-gray-50'}`}>
                                                {isLunchPeriod
                                                    ? (isCompact ? '12:00' : (targetClass?.level === 'İlkokul' || targetClass?.level === 'Anaokulu' ? '11:50-12:25' : '12:30-13:05'))
                                                    : (isCompact ? getTimeInfo(period, targetClass?.level).split('-')[0] : getTimeInfo(period, targetClass?.level))
                                                }
                                            </td>
                                            {isLunchPeriod ? (
                                                <td colSpan={5} className={`${cellPadding} font-semibold text-gray-900 border border-gray-400 ${textSize} text-center`}>
                                                    {isCompact ? 'ÖĞLE YEMEĞİ' : 'ÖĞLE YEMEĞİ / LUNCH'}
                                                </td>
                                            ) : (
                                                DAYS.map(day => {
                                                    const slot = type === 'class'
                                                        ? localGrid[targetId]?.[day]?.[period]
                                                        : currentSchedule?.[day]?.[period];

                                                    const slotKey = `${day}-${period}`;
                                                    const isSuggested = type === 'class' && suggestedSlots.has(slotKey);

                                                    return (
                                                        <td
                                                            key={day}
                                                            onDragOver={handleDragOver}
                                                            onDrop={() => {
                                                                if (type === 'class') {
                                                                    handleDrop(day, period, targetId);
                                                                } else {
                                                                    // Teacher view: use slot's classId if exists, or dragged lesson's classId
                                                                    const dropClassId = slot?.classId || draggedLesson?.classId;
                                                                    if (dropClassId) {
                                                                        handleDrop(day, period, dropClassId);
                                                                    }
                                                                }
                                                            }}
                                                            className={`${cellPadding} border border-gray-300 ${isSuggested ? 'bg-emerald-100' : ''}`}
                                                        >
                                                            {slot ? (
                                                                <div
                                                                    draggable
                                                                    onDragStart={() => handleGridDragStart(day, period, type === 'class' ? targetId : slot.classId)}
                                                                    className={`text-center rounded group relative cursor-grab active:cursor-grabbing hover:bg-gray-100 h-full flex flex-col justify-center ${isCompact ? 'p-0.5' : 'p-2'}`}
                                                                >
                                                                    {type === 'class' ? (
                                                                        <>
                                                                            <div className={`font-semibold text-gray-900 ${textSize} leading-tight truncate`}>
                                                                                {getTeacherName((slot as ScheduleSlot).teacherId || '')}
                                                                            </div>
                                                                            <div className={`${smallTextSize} text-gray-500 truncate`}>
                                                                                {getSubjectName(slot.subjectId)}
                                                                            </div>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <div className={`font-semibold text-gray-900 ${textSize} leading-tight truncate`}>
                                                                                {getClassName(slot.classId)}
                                                                            </div>
                                                                            <div className={`${smallTextSize} text-gray-500 truncate`}>
                                                                                {getSubjectName(slot.subjectId)}
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                    {!isSuperCompact && (
                                                                        <button
                                                                            onClick={() => handleRemoveSlot(day, period, type === 'class' ? targetId : slot.classId)}
                                                                            className={`absolute -top-1 -right-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow ${isCompact ? 'w-4 h-4' : 'w-5 h-5'}`}
                                                                            title="Dersi Kaldır"
                                                                        >
                                                                            <Trash2 size={iconSize} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <div className={`text-center text-gray-300 ${smallTextSize} flex items-center justify-center h-full min-h-[1.5rem]`}>
                                                                    {isSuggested ? (
                                                                        <span className="text-emerald-600 font-medium">+</span>
                                                                    ) : '—'}
                                                                </div>
                                                            )}
                                                        </td>
                                                    );
                                                })
                                            )}
                                        </tr>
                                        {showAfternoonBreakAfter && (
                                            <tr className="bg-yellow-400">
                                                <td className={`${cellPadding} font-semibold text-gray-900 border border-gray-400 ${smallTextSize} text-center`}>ARA</td>
                                                <td className={`${cellPadding} font-medium text-gray-900 border border-gray-400 ${smallTextSize} text-center whitespace-nowrap`}>14:35</td>
                                                <td colSpan={5} className={`${cellPadding} font-semibold text-gray-900 border border-gray-400 ${textSize} text-center`}>
                                                    IKND
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 bg-gray-100 flex flex-col">
            {/* Save Warning Modal */}
            <ConfirmationModal
                isOpen={showSaveWarning}
                onClose={() => setShowSaveWarning(false)}
                onConfirm={performSave}
                title="Yerleştirilmemiş Dersler Var"
                message={`${unassignedLessons.length} ders için toplam ${totalUnassigned} saat henüz yerleştirilmedi.\n\nYerleştirilmemiş dersler:\n${unassignedLessons.map(l => `• ${l.className} - ${l.subjectName} (${l.missingHours} saat)`).join('\n')}\n\nYine de kaydetmek istiyor musunuz?`}
                type="warning"
                confirmText="Evet, Kaydet"
                cancelText="İptal"
                confirmVariant="primary"
            />

            {/* Conflict Modal */}
            {conflictSuggestion && (
                <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center">
                    <div className="bg-white rounded-xl shadow-2xl p-5 max-w-md w-full mx-4">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                                <AlertTriangle className="w-6 h-6 text-amber-600" />
                            </div>
                            <div>
                                <h3 className="font-bold text-gray-900 text-lg">Çakışma Tespit Edildi</h3>
                                <p className="text-gray-600">{conflictSuggestion.message}</p>
                            </div>
                        </div>

                        {conflictSuggestion.alternatives.length > 0 && (
                            <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                                <p className="text-sm text-gray-600 mb-2 font-medium">Alternatif boş slotlar:</p>
                                <div className="flex flex-wrap gap-2">
                                    {conflictSuggestion.alternatives.map((alt, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => handleAlternativeClick(alt.day, alt.period)}
                                            className="px-4 py-2 bg-emerald-50 text-emerald-700 text-sm rounded-lg hover:bg-emerald-100 font-medium flex items-center gap-1 border border-emerald-200"
                                        >
                                            {alt.label}
                                            <ArrowRight className="w-3 h-3" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setConflictSuggestion(null);
                                    // Do NOT clear dragged items here to allow retry if needed, 
                                    // but usually we want to cancel the drag if they close the modal.
                                    // However, user might want to drag somewhere else.
                                    setDraggedLesson(null);
                                    setDraggedFromGrid(null);
                                    setSuggestedSlots(new Set());
                                }}
                                className="flex-1 py-2.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
                            >
                                İptal
                            </button>
                            <button
                                onClick={handleForcePlace}
                                className="flex-1 py-2.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium"
                            >
                                Yine de Yerleştir
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between flex-shrink-0 shadow-sm">
                <div className="flex items-center gap-4">
                    <button onClick={onCancel} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                        <X className="w-5 h-5 text-gray-500" />
                    </button>
                    <div>
                        <h1 className="font-bold text-gray-900 text-lg">Program Düzenleyici</h1>
                        <p className="text-xs text-gray-500">Dersleri sürükle-bırak ile düzenleyin</p>
                    </div>

                    {/* View Mode Toggle */}
                    <div className="flex items-center bg-gray-100 rounded-lg p-1 ml-4">
                        <button
                            onClick={() => setViewMode('class')}
                            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors
                                ${viewMode === 'class' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <Building className="w-4 h-4" />
                            Sınıf
                        </button>
                        <button
                            onClick={() => {
                                setViewMode('teacher');
                                if (selectedTeacherIds.length === 0 && teachers.length > 0) {
                                    setSelectedTeacherIds([teachers[0].id]);
                                }
                            }}
                            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors
                                ${viewMode === 'teacher' ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <Users className="w-4 h-4" />
                            Öğretmen
                        </button>
                    </div>

                    <div className="h-6 w-px bg-gray-300 mx-2"></div>

                    {/* Selector */}
                    {viewMode === 'class' ? (
                        <div className="flex items-center gap-2">
                            <select
                                value={selectedClassId}
                                onChange={(e) => setSelectedClassId(e.target.value)}
                                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                            >
                                {classes.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                            {selectedClass && (
                                <span className="text-sm text-gray-500 bg-gray-100 px-2 py-1 rounded">{selectedClass.level}</span>
                            )}
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            {/* Aranabilir Öğretmen Dropdown */}
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setTeacherSearchQuery(teacherSearchQuery ? '' : ' ')}
                                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white flex items-center gap-2 min-w-[180px] justify-between"
                                >
                                    <span className="text-gray-700">Öğretmen Ekle...</span>
                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>

                                {/* Dropdown Menu with Search */}
                                {teacherSearchQuery !== '' && (
                                    <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                                        {/* Search Input inside dropdown */}
                                        <div className="p-2 border-b border-gray-100">
                                            <input
                                                type="text"
                                                placeholder="🔍 Öğretmen ara..."
                                                value={teacherSearchQuery.trim()}
                                                onChange={(e) => setTeacherSearchQuery(e.target.value || ' ')}
                                                autoFocus
                                                className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                            />
                                        </div>

                                        {/* Teacher List */}
                                        <div className="max-h-60 overflow-y-auto">
                                            {teachers
                                                .filter(t => !selectedTeacherIds.includes(t.id))
                                                .filter(t => teacherSearchQuery.trim() === '' || t.name.toLocaleLowerCase('tr-TR').includes(teacherSearchQuery.trim().toLocaleLowerCase('tr-TR')))
                                                .sort((a, b) => a.name.localeCompare(b.name, 'tr-TR'))
                                                .map(t => (
                                                    <button
                                                        key={t.id}
                                                        onClick={() => {
                                                            if (selectedTeacherIds.length >= 3) {
                                                                alert("En fazla 3 öğretmen seçebilirsiniz.");
                                                            } else {
                                                                setSelectedTeacherIds(prev => [...prev, t.id]);
                                                            }
                                                            setTeacherSearchQuery('');
                                                        }}
                                                        className="w-full px-3 py-2 text-left text-sm hover:bg-emerald-50 border-b border-gray-50 last:border-0 flex items-center gap-2"
                                                    >
                                                        <span className="text-emerald-600">👨‍🏫</span>
                                                        <span>{t.name}</span>
                                                    </button>
                                                ))
                                            }
                                            {teachers.filter(t => !selectedTeacherIds.includes(t.id)).filter(t => teacherSearchQuery.trim() === '' || t.name.toLocaleLowerCase('tr-TR').includes(teacherSearchQuery.trim().toLocaleLowerCase('tr-TR'))).length === 0 && (
                                                <div className="px-3 py-4 text-sm text-gray-500 text-center">Öğretmen bulunamadı</div>
                                            )}
                                        </div>

                                        {/* Close button */}
                                        <div className="p-2 border-t border-gray-100 text-center">
                                            <button
                                                onClick={() => setTeacherSearchQuery('')}
                                                className="text-xs text-gray-500 hover:text-gray-700"
                                            >
                                                Kapat
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-2">
                                {selectedTeacherIds.map(id => {
                                    const t = teachers.find(tea => tea.id === id);
                                    return (
                                        <div key={id} className="bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg text-sm font-medium flex items-center gap-1 border border-emerald-100">
                                            {t?.name}
                                            {selectedTeacherIds.length > 1 && (
                                                <button
                                                    onClick={() => setSelectedTeacherIds(prev => prev.filter(tid => tid !== id))}
                                                    className="hover:text-red-500 ml-1 p-0.5 rounded-full hover:bg-emerald-100"
                                                >
                                                    <X size={12} />
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-3">
                    {totalUnassigned > 0 ? (
                        <span className="text-sm bg-amber-100 text-amber-700 px-3 py-1 rounded-full font-medium">{totalUnassigned} bekliyor</span>
                    ) : (
                        <span className="text-sm bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full font-medium flex items-center gap-1">
                            <CheckCircle className="w-4 h-4" /> Tamamlandı
                        </span>
                    )}
                    <div className="h-6 w-px bg-gray-300"></div>
                    <button onClick={handleUndo} disabled={history.length === 0} className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-40 transition-colors" title="Geri Al">
                        <Undo2 className="w-5 h-5" />
                    </button>
                    <button onClick={handleReset} className="p-2 hover:bg-gray-100 rounded-lg transition-colors" title="Sıfırla">
                        <RotateCcw className="w-5 h-5" />
                    </button>
                    <button onClick={handleSave} className="px-5 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 flex items-center gap-2 shadow-sm">
                        <Save className="w-4 h-4" />
                        Kaydet ve Bitir
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left Panel - Unassigned */}
                <div className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
                    <div className="p-3 border-b border-gray-200 bg-gradient-to-r from-amber-500 to-amber-600">
                        <div className="flex items-center gap-2 text-white">
                            {totalUnassigned > 0 ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle className="w-5 h-5" />}
                            <span className="font-semibold">Bekleyen Dersler</span>
                            <span className="ml-auto bg-white/20 px-2 py-0.5 rounded text-sm">{totalUnassigned}</span>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {unassignedLessons.length === 0 ? (
                            <div className="text-center py-8">
                                <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                                <p className="font-semibold text-gray-800">Harika!</p>
                                <p className="text-sm text-gray-500">Tüm dersler yerleştirildi.</p>
                            </div>
                        ) : (
                            unassignedLessons.map((lesson, index) => {
                                const key = `${lesson.classId}-${lesson.subjectId}-${lesson.teacherId}`;
                                const suggestionCount = calculateSuggestions(lesson).size;
                                const isActive = showSuggestions === key;

                                return (
                                    <div
                                        key={index}
                                        draggable
                                        onDragStart={() => handleDragStart(lesson)}
                                        onDragEnd={() => {
                                            if (!conflictSuggestion) {
                                                setDraggedLesson(null);
                                                if (!isActive) setSuggestedSlots(new Set());
                                            }
                                        }}
                                        className={`p-3 bg-gray-50 rounded-lg border-2 cursor-grab active:cursor-grabbing transition-all
                                            ${isActive ? 'border-emerald-500 bg-emerald-50' : 'border-gray-200 hover:border-gray-300'}`}
                                    >
                                        <div className="flex items-start gap-2">
                                            <GripVertical className="w-4 h-4 text-gray-400 mt-0.5" />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className="font-bold text-gray-900">{lesson.className}</span>
                                                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{lesson.missingHours} sa</span>
                                                </div>
                                                <p className="font-medium text-gray-700 text-sm">{lesson.subjectName}</p>
                                                <p className="text-xs text-gray-500">{lesson.teacherName}</p>
                                                {suggestionCount > 0 && (
                                                    <button
                                                        onClick={() => handleShowSuggestions(key)}
                                                        className={`mt-2 flex items-center gap-1 text-xs font-medium
                                                            ${isActive ? 'text-emerald-600' : 'text-gray-400 hover:text-emerald-600'}`}
                                                    >
                                                        <Lightbulb className="w-3 h-3" />
                                                        {suggestionCount} öneri
                                                        <ChevronDown className={`w-3 h-3 transition-transform ${isActive ? 'rotate-180' : ''}`} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Main Grid */}
                {/* Main Grid */}
                <div className="flex-1 p-4 overflow-auto flex gap-4">
                    {viewMode === 'class' ? (
                        <div className="flex-1 min-w-[800px] h-full">
                            {renderScheduleGrid(selectedClassId, 'class')}
                        </div>
                    ) : (
                        selectedTeacherIds.map(id => (
                            <div key={id} className={`flex-1 h-full ${selectedTeacherIds.length > 1 ? 'min-w-[300px]' : 'min-w-[800px]'}`}>
                                {renderScheduleGrid(id, 'teacher')}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default ManualScheduleEditor;
