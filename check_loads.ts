
import fs from 'fs';
import path from 'path';

const csvPath = '/Users/alim.keskin/Desktop/guncelproje 2 kopyası/dagitimsekli1_v2_guncel.csv';
const content = fs.readFileSync(csvPath, 'utf-8');
const lines = content.split('\n').filter(l => l.trim().length > 0);

const classHours: { [key: string]: number } = {};

lines.forEach((line, idx) => {
    // Format: TEACHER;BRANCH;LEVEL;SUBJECT;CLASS;HOURS;DIST
    const parts = line.split(';');
    if (parts.length < 6) return;
    const className = parts[4].trim();
    const hours = parseInt(parts[5].trim());

    if (!isNaN(hours)) {
        classHours[className] = (classHours[className] || 0) + hours;
    }
});

console.log("--- Class Weekly Load Report ---");
Object.entries(classHours).sort().forEach(([cls, load]) => {
    const status = load > 45 ? "OVERLOAD" : (load < 45 ? "UNDERLOAD" : "OK");
    console.log(`${cls}: ${load} hours [${status}]`);
});
