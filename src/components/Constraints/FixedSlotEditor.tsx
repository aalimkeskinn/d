import React, { useState } from 'react';
import { Plus, Trash2, Clock, User, Building, BookOpen, Pin } from 'lucide-react';
import { Teacher, Class, Subject } from '../../types';
import { FixedSlot } from '../../types/wizard';
import SearchableSelect from '../UI/SearchableSelect';

const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
const PERIODS = ['1', '2', '3', '4', '5', '7', '8', '9', '10'];

interface FixedSlotEditorProps {
    teachers: Teacher[];
    classes: Class[];
    subjects: Subject[];
    fixedSlots: FixedSlot[];
    onSave: (newFixedSlots: FixedSlot[]) => void;
}

const FixedSlotEditor: React.FC<FixedSlotEditorProps> = ({
    teachers,
    classes,
    subjects,
    fixedSlots,
    onSave
}) => {
    const [selectedTeacherId, setSelectedTeacherId] = useState('');
    const [selectedClassId, setSelectedClassId] = useState('');
    const [selectedSubjectId, setSelectedSubjectId] = useState('');
    const [selectedDay, setSelectedDay] = useState('');
    const [selectedPeriod, setSelectedPeriod] = useState('');

    const teacherOptions = teachers.map(t => ({ value: t.id, label: `${t.name} (${t.branch})` }));
    const classOptions = classes.map(c => ({ value: c.id, label: c.name }));
    const subjectOptions = subjects.map(s => ({ value: s.id, label: `${s.name}${s.className ? ` (${s.className})` : ''}` }));
    const dayOptions = DAYS.map(d => ({ value: d, label: d }));
    const periodOptions = PERIODS.map(p => ({ value: p, label: `${p}. Ders` }));

    const handleAddFixedSlot = () => {
        if (!selectedTeacherId || !selectedClassId || !selectedSubjectId || !selectedDay || !selectedPeriod) {
            return;
        }

        const teacher = teachers.find(t => t.id === selectedTeacherId);
        const classItem = classes.find(c => c.id === selectedClassId);
        const subject = subjects.find(s => s.id === selectedSubjectId);

        if (!teacher || !classItem || !subject) return;

        // Aynı gün ve saat için zaten var mı kontrol et
        const existingSlot = fixedSlots.find(
            slot => slot.classId === selectedClassId && slot.day === selectedDay && slot.period === selectedPeriod
        );

        if (existingSlot) {
            alert(`Bu sınıfın ${selectedDay} ${selectedPeriod}. ders için zaten bir sabit dersi var!`);
            return;
        }

        // Aynı öğretmen, aynı gün ve saat için zaten var mı kontrol et
        const teacherConflict = fixedSlots.find(
            slot => slot.teacherId === selectedTeacherId && slot.day === selectedDay && slot.period === selectedPeriod
        );

        if (teacherConflict) {
            alert(`Bu öğretmenin ${selectedDay} ${selectedPeriod}. derste zaten başka bir sabit dersi var!`);
            return;
        }

        const newSlot: FixedSlot = {
            id: `fixed-${Date.now()}`,
            teacherId: selectedTeacherId,
            teacherName: teacher.name,
            classId: selectedClassId,
            className: classItem.name,
            subjectId: selectedSubjectId,
            subjectName: subject.name,
            day: selectedDay,
            period: selectedPeriod,
            createdAt: new Date()
        };

        onSave([...fixedSlots, newSlot]);

        // Formu temizle
        setSelectedPeriod('');
    };

    const handleRemoveFixedSlot = (slotId: string) => {
        onSave(fixedSlots.filter(slot => slot.id !== slotId));
    };

    // Sabit dersleri grupla (öğretmene göre)
    const groupedSlots = fixedSlots.reduce((acc, slot) => {
        if (!acc[slot.teacherId]) {
            acc[slot.teacherId] = [];
        }
        acc[slot.teacherId].push(slot);
        return acc;
    }, {} as Record<string, FixedSlot[]>);

    return (
        <div className="space-y-6">
            {/* Yeni Sabit Ders Ekleme Formu */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Pin className="w-5 h-5 text-ide-primary-600" />
                    Yeni Sabit Ders Ekle
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <User className="w-4 h-4 inline mr-1" />
                            Öğretmen
                        </label>
                        <SearchableSelect
                            label=""
                            placeholder="Öğretmen seçin..."
                            value={selectedTeacherId}
                            onChange={setSelectedTeacherId}
                            options={teacherOptions}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <Building className="w-4 h-4 inline mr-1" />
                            Sınıf
                        </label>
                        <SearchableSelect
                            label=""
                            placeholder="Sınıf seçin..."
                            value={selectedClassId}
                            onChange={setSelectedClassId}
                            options={classOptions}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <BookOpen className="w-4 h-4 inline mr-1" />
                            Ders
                        </label>
                        <SearchableSelect
                            label=""
                            placeholder="Ders seçin..."
                            value={selectedSubjectId}
                            onChange={setSelectedSubjectId}
                            options={subjectOptions}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <Clock className="w-4 h-4 inline mr-1" />
                            Gün
                        </label>
                        <SearchableSelect
                            label=""
                            placeholder="Gün seçin..."
                            value={selectedDay}
                            onChange={setSelectedDay}
                            options={dayOptions}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            <Clock className="w-4 h-4 inline mr-1" />
                            Ders Saati
                        </label>
                        <SearchableSelect
                            label=""
                            placeholder="Saat seçin..."
                            value={selectedPeriod}
                            onChange={setSelectedPeriod}
                            options={periodOptions}
                        />
                    </div>

                    <div className="flex items-end">
                        <button
                            onClick={handleAddFixedSlot}
                            disabled={!selectedTeacherId || !selectedClassId || !selectedSubjectId || !selectedDay || !selectedPeriod}
                            className="w-full px-4 py-2 bg-ide-primary-600 text-white rounded-lg hover:bg-ide-primary-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <Plus className="w-4 h-4" />
                            Ekle
                        </button>
                    </div>
                </div>
            </div>

            {/* Mevcut Sabit Dersler */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Pin className="w-5 h-5 text-green-600" />
                    Kayıtlı Sabit Dersler
                    <span className="ml-2 px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">
                        {fixedSlots.length} adet
                    </span>
                </h3>

                {fixedSlots.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <Pin className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                        <p>Henüz sabit ders eklenmemiş.</p>
                        <p className="text-sm">Yukarıdaki formu kullanarak sabit ders ekleyebilirsiniz.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {Object.entries(groupedSlots).map(([teacherId, slots]) => (
                            <div key={teacherId} className="border border-gray-200 rounded-lg overflow-hidden">
                                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                                    <span className="font-medium text-gray-900">{slots[0].teacherName}</span>
                                    <span className="ml-2 text-sm text-gray-500">({slots.length} sabit ders)</span>
                                </div>
                                <div className="divide-y divide-gray-100">
                                    {slots.map(slot => (
                                        <div key={slot.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
                                            <div className="flex items-center gap-4">
                                                <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded font-medium">
                                                    {slot.className}
                                                </span>
                                                <span className="text-gray-900">{slot.subjectName}</span>
                                                <span className="text-gray-500 text-sm">
                                                    {slot.day} - {slot.period}. ders
                                                </span>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveFixedSlot(slot.id)}
                                                className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                                title="Sabit dersi sil"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default FixedSlotEditor;
