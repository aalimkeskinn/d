
import * as fs from 'fs';
import * as path from 'path';

const csvPath = path.join(process.cwd(), 'dagitimsekli1_v2_guncel.csv');
const csvContent = fs.readFileSync(csvPath, 'utf-8');

const lines = csvContent.split('\n').filter(line => line.trim() && !line.startsWith(';'));
const dataLines = lines.slice(1);

const classHours: { [className: string]: number } = {};

dataLines.forEach((line, index) => {
    const columns = line.split(';').map(col => (col || '').trim().replace(/^"|"$/g, ''));
    if (columns.length < 6) return;

    const classNameStr = columns[4];
    const weeklyHoursStr = columns[5];

    if (!classNameStr || !weeklyHoursStr) return;

    const classNames = classNameStr.split('/').map(c => c.trim());
    const hours = parseInt(weeklyHoursStr, 10) || 0;

    classNames.forEach(className => {
        classHours[className] = (classHours[className] || 0) + hours;
    });
});

console.log('--- Class Hours Check ---');
let hasError = false;
Object.entries(classHours).forEach(([className, totalHours]) => {
    if (totalHours !== 45) {
        console.log(`❌ ${className}: ${totalHours} hours (Expected: 45)`);
        hasError = true;
    } else {
        // console.log(`✅ ${className}: 45 hours`);
    }
});

if (!hasError) {
    console.log('✅ All classes have exactly 45 hours.');
} else {
    console.log('⚠️ Some classes do not meet the 45-hour requirement.');
}
