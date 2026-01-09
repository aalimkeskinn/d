
import { generateSystematicSchedule } from './scheduleGeneration.ts';
import { Teacher, Class, Subject, Schedule } from '../types/index.ts';
import { SubjectTeacherMapping } from '../types/wizard.ts';
import { TimeConstraint } from '../types/constraints.ts';

// Mock Data Generator
const createMockData = (numClasses: number, numTeachers: number, utilization: number) => {
    const classes: Class[] = Array.from({ length: numClasses }, (_, i) => ({
        id: `c${i}`,
        name: `Class ${i}`,
        level: 'İlkokul',
        createdAt: new Date(),
        assignments: []
    }));

    const teachers: Teacher[] = Array.from({ length: numTeachers }, (_, i) => ({
        id: `t${i}`,
        name: `Teacher ${i}`,
        branch: 'General',
        level: 'İlkokul',
        createdAt: new Date()
    }));

    const subjects: Subject[] = [
        { id: 's1', name: 'Math', branch: 'Math', level: 'İlkokul', weeklyHours: 5, createdAt: new Date() },
        { id: 's2', name: 'Science', branch: 'Science', level: 'İlkokul', weeklyHours: 4, createdAt: new Date() },
        { id: 's3', name: 'Turkish', branch: 'Turkish', level: 'İlkokul', weeklyHours: 5, createdAt: new Date() },
        { id: 's4', name: 'Social', branch: 'Social', level: 'İlkokul', weeklyHours: 3, createdAt: new Date() },
        { id: 's5', name: 'English', branch: 'English', level: 'İlkokul', weeklyHours: 3, createdAt: new Date() },
        { id: 's6', name: 'Art', branch: 'Art', level: 'İlkokul', weeklyHours: 2, createdAt: new Date() },
        { id: 's7', name: 'Music', branch: 'Music', level: 'İlkokul', weeklyHours: 2, createdAt: new Date() },
        { id: 's8', name: 'PE', branch: 'PE', level: 'İlkokul', weeklyHours: 2, createdAt: new Date() },
    ];

    // Create Mappings
    const mappings: SubjectTeacherMapping[] = [];
    const totalSlots = numClasses * 5 * 8; // 5 days, 8 periods (excluding lunch/breaks)
    const targetHours = Math.floor(totalSlots * utilization);

    let assignedHours = 0;
    let teacherIndex = 0;

    for (const cls of classes) {
        for (const sub of subjects) {
            if (assignedHours >= targetHours) break;

            const teacher = teachers[teacherIndex % numTeachers];
            mappings.push({
                id: `${cls.id}-${sub.id}`,
                classId: cls.id,
                subjectId: sub.id,
                teacherId: teacher.id,
                weeklyHours: sub.weeklyHours,
                assignedHours: 0,
                priority: 'medium',
                distribution: sub.weeklyHours === 5 ? [2, 2, 1] : sub.weeklyHours === 4 ? [2, 2] : undefined
            });

            assignedHours += sub.weeklyHours;
            teacherIndex++;
        }
    }

    return { classes, teachers, subjects, mappings };
};

// Run Test
const runTest = () => {

    // 10 classes, 10 teachers, 95% utilization
    // 10 * 40 = 400 slots. Target ~380 hours.
    const { classes, teachers, subjects, mappings } = createMockData(10, 10, 0.95);

    const stopRef = { current: false };
    const globalRules = {
        maxDailyHoursTeacher: 6,
        maxDailyHoursClass: 8,
        maxConsecutiveHours: 3,
        avoidConsecutiveSameSubject: true,
        preferMorningHours: true,
        avoidFirstLastPeriod: false,
        lunchBreakRequired: true,
        lunchBreakDuration: 1,
        useDistributionPatterns: true,
        preferBlockScheduling: true,
        enforceDistributionPatterns: false,
        maximumBlockSize: 2
    };

    const runAsync = async () => {
        const result = await generateSystematicSchedule(
            mappings,
            teachers,
            classes,
            subjects,
            [], // No time constraints
            globalRules,
            stopRef  // MutableRefObject<boolean>
        );




    };

    runAsync();
};

runTest();
