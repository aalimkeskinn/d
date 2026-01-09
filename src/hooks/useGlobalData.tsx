import React, { createContext, useContext, ReactNode } from 'react';
import { useFirestore } from './useFirestore';
import { Teacher, Class, Subject, Schedule } from '../types';

// Schedule Template interface
interface ScheduleTemplate {
    id: string;
    name: string;
    description: string;
    academicYear: string;
    semester: string;
    wizardData: any;
    createdAt: Date;
    updatedAt: Date;
    status: 'draft' | 'published' | 'archived';
}

interface GlobalDataContextType {
    // Data
    teachers: Teacher[];
    classes: Class[];
    subjects: Subject[];
    schedules: Schedule[];
    templates: ScheduleTemplate[];

    // Loading states
    loading: boolean;
    loadingTeachers: boolean;
    loadingClasses: boolean;
    loadingSubjects: boolean;
    loadingSchedules: boolean;
    loadingTemplates: boolean;

    // CRUD operations
    addTeacher: (item: Omit<Teacher, 'id' | 'createdAt'>) => Promise<{ success: boolean; id?: string; error?: string }>;
    updateTeacher: (id: string, updates: Partial<Omit<Teacher, 'id' | 'createdAt'>>) => Promise<{ success: boolean; error?: string }>;
    removeTeacher: (id: string) => Promise<{ success: boolean; error?: string }>;

    addClass: (item: Omit<Class, 'id' | 'createdAt'>) => Promise<{ success: boolean; id?: string; error?: string }>;
    updateClass: (id: string, updates: Partial<Omit<Class, 'id' | 'createdAt'>>) => Promise<{ success: boolean; error?: string }>;
    removeClass: (id: string) => Promise<{ success: boolean; error?: string }>;

    addSubject: (item: Omit<Subject, 'id' | 'createdAt'>) => Promise<{ success: boolean; id?: string; error?: string }>;
    updateSubject: (id: string, updates: Partial<Omit<Subject, 'id' | 'createdAt'>>) => Promise<{ success: boolean; error?: string }>;
    removeSubject: (id: string) => Promise<{ success: boolean; error?: string }>;

    addSchedule: (item: Omit<Schedule, 'id' | 'createdAt'>) => Promise<{ success: boolean; id?: string; error?: string }>;
    updateSchedule: (id: string, updates: Partial<Omit<Schedule, 'id' | 'createdAt'>>) => Promise<{ success: boolean; error?: string }>;
    removeSchedule: (id: string) => Promise<{ success: boolean; error?: string }>;

    addTemplate: (item: Omit<ScheduleTemplate, 'id' | 'createdAt'>) => Promise<{ success: boolean; id?: string; error?: string }>;
    updateTemplate: (id: string, updates: Partial<Omit<ScheduleTemplate, 'id' | 'createdAt'>>) => Promise<{ success: boolean; error?: string }>;
    removeTemplate: (id: string) => Promise<{ success: boolean; error?: string }>;
}

const GlobalDataContext = createContext<GlobalDataContextType | null>(null);

export const GlobalDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Load all data once at the top level
    const {
        data: teachers,
        loading: loadingTeachers,
        add: addTeacher,
        update: updateTeacher,
        remove: removeTeacher
    } = useFirestore<Teacher>('teachers');

    const {
        data: classes,
        loading: loadingClasses,
        add: addClass,
        update: updateClass,
        remove: removeClass
    } = useFirestore<Class>('classes');

    const {
        data: subjects,
        loading: loadingSubjects,
        add: addSubject,
        update: updateSubject,
        remove: removeSubject
    } = useFirestore<Subject>('subjects');

    const {
        data: schedules,
        loading: loadingSchedules,
        add: addSchedule,
        update: updateSchedule,
        remove: removeSchedule
    } = useFirestore<Schedule>('schedules');

    const {
        data: templates,
        loading: loadingTemplates,
        add: addTemplate,
        update: updateTemplate,
        remove: removeTemplate
    } = useFirestore<ScheduleTemplate>('schedule-templates');

    const loading = loadingTeachers || loadingClasses || loadingSubjects || loadingSchedules || loadingTemplates;

    const value: GlobalDataContextType = {
        teachers,
        classes,
        subjects,
        schedules,
        templates,
        loading,
        loadingTeachers,
        loadingClasses,
        loadingSubjects,
        loadingSchedules,
        loadingTemplates,
        addTeacher,
        updateTeacher,
        removeTeacher,
        addClass,
        updateClass,
        removeClass,
        addSubject,
        updateSubject,
        removeSubject,
        addSchedule,
        updateSchedule,
        removeSchedule,
        addTemplate,
        updateTemplate,
        removeTemplate,
    };

    return (
        <GlobalDataContext.Provider value={value}>
            {children}
        </GlobalDataContext.Provider>
    );
};

export const useGlobalData = (): GlobalDataContextType => {
    const context = useContext(GlobalDataContext);
    if (!context) {
        throw new Error('useGlobalData must be used within a GlobalDataProvider');
    }
    return context;
};
