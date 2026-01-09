// --- START OF FILE src/pages/WizardStepSubjects.tsx ---

import React, { useState } from 'react';
import { BookOpen, Plus, Minus, Edit, Trash2, CheckSquare, Square, Clock, Star } from 'lucide-react';
import { Subject, EDUCATION_LEVELS, parseDistributionPattern, validateDistributionPattern, generateDistributionSuggestions } from '../../types';
import { WizardData } from '../../types/wizard';
import { useFirestore } from '../../hooks/useFirestore';
import { useToast } from '../../hooks/useToast';
import Button from '../../components/UI/Button';
import Select from '../../components/UI/Select';
import Modal from '../../components/UI/Modal';
import Input from '../../components/UI/Input';

interface WizardStepSubjectsProps {
  data: WizardData['subjects'];
  onUpdate: (data: WizardData['subjects']) => void;
  subjects?: Subject[]; // Added to support CSV data
}

const WizardStepSubjects: React.FC<WizardStepSubjectsProps> = ({ data, onUpdate, subjects: droppedSubjects }) => {
  const { data: firestoreSubjects, add: addSubject, update: updateSubject, remove: removeSubject } = useFirestore<Subject>('subjects');
  const allSubjects = droppedSubjects && droppedSubjects.length > 0 ? droppedSubjects : firestoreSubjects;
  const { success, error } = useToast();
  const [selectedLevel, setSelectedLevel] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);

  const [formData, setFormData] = useState({
    name: '', branch: '', levels: [] as ('Anaokulu' | 'İlkokul' | 'Ortaokul')[],
    weeklyHours: '1', distributionPattern: '',
  });
  const [searchTerm, setSearchTerm] = useState('');

  const filteredSubjects = allSubjects
    .filter(subject => !selectedLevel || (subject.levels || [subject.level]).includes(selectedLevel as any))
    .filter(subject => !searchTerm ||
      subject.name.toLocaleLowerCase('tr-TR').includes(searchTerm.toLocaleLowerCase('tr-TR')) ||
      subject.branch.toLocaleLowerCase('tr-TR').includes(searchTerm.toLocaleLowerCase('tr-TR'))
    );

  const selectedSubjects = allSubjects
    .filter(subject => data.selectedSubjects.includes(subject.id))
    .sort((a, b) => {
      const priorityOrder = { 'high': 1, 'medium': 2, 'low': 3 };
      const priorityA = priorityOrder[data.subjectPriorities[a.id] || 'medium'];
      const priorityB = priorityOrder[data.subjectPriorities[b.id] || 'medium'];
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.name.localeCompare(b.name, 'tr');
    });

  const handleSubjectToggle = (subjectId: string) => {
    const isSelected = data.selectedSubjects.includes(subjectId);
    const newSelectedSubjects = isSelected
      ? data.selectedSubjects.filter(id => id !== subjectId)
      : [...data.selectedSubjects, subjectId];

    const newSubjectHours = { ...data.subjectHours };
    const newSubjectPriorities = { ...data.subjectPriorities };

    if (isSelected) {
      delete newSubjectHours[subjectId];
      delete newSubjectPriorities[subjectId];
    } else {
      const subject = allSubjects.find(s => s.id === subjectId);
      newSubjectHours[subjectId] = subject?.weeklyHours || 1;

      const isCoreSubject = ['TÜRKÇE', 'MATEMATİK', 'FEN BİLİMLERİ', 'SOSYAL BİLGİLER', 'İNGİLİZCE'].some(core => subject?.name.toUpperCase().includes(core));
      newSubjectPriorities[subjectId] = isCoreSubject ? 'high' : 'medium';
    }

    onUpdate({ selectedSubjects: newSelectedSubjects, subjectHours: newSubjectHours, subjectPriorities: newSubjectPriorities });
  };

  const handlePriorityChange = (subjectId: string, priority: 'high' | 'medium' | 'low') => {
    onUpdate({ ...data, subjectPriorities: { ...data.subjectPriorities, [subjectId]: priority } });
  };

  // handleHoursChange is commented out but may be needed for UI later
  // const handleHoursChange = (subjectId: string, hours: number) => {
  //   onUpdate({ ...data, subjectHours: { ...data.subjectHours, [subjectId]: Math.max(1, hours) } });
  // };

  const handleSelectAll = () => {
    const currentFilteredIds = filteredSubjects.map(s => s.id);
    const allCurrentlySelected = currentFilteredIds.length > 0 && currentFilteredIds.every(id => data.selectedSubjects.includes(id));

    let newSelectedSubjects = [...data.selectedSubjects];
    const newSubjectHours = { ...data.subjectHours };
    const newSubjectPriorities = { ...data.subjectPriorities };

    if (allCurrentlySelected) {
      newSelectedSubjects = data.selectedSubjects.filter(id => !currentFilteredIds.includes(id));
      currentFilteredIds.forEach(id => {
        delete newSubjectHours[id];
        delete newSubjectPriorities[id];
      });
      success('✅ Seçim Kaldırıldı', `${currentFilteredIds.length} dersin seçimi kaldırıldı`);
    } else {
      currentFilteredIds.forEach(id => {
        if (!data.selectedSubjects.includes(id)) {
          newSelectedSubjects.push(id);
          const subject = allSubjects.find(s => s.id === id);
          newSubjectHours[id] = subject?.weeklyHours || 1;
          const isCoreSubject = ['TÜRKÇE', 'MATEMATİK', 'FEN BİLİMLERİ', 'SOSYAL BİLGİLER', 'İNGİLİZCE'].some(core => subject?.name.toUpperCase().includes(core));
          newSubjectPriorities[id] = isCoreSubject ? 'high' : 'medium';
        }
      });
      success('✅ Tümü Seçildi', `${currentFilteredIds.length} ders seçildi`);
    }
    onUpdate({ selectedSubjects: newSelectedSubjects, subjectHours: newSubjectHours, subjectPriorities: newSubjectPriorities });
  };

  // getTotalWeeklyHours is not currently used
  // const getTotalWeeklyHours = () => selectedSubjects.reduce((sum, subject) => sum + (data.subjectHours[subject.id] || subject.weeklyHours), 0);

  const resetForm = () => {
    setFormData({ name: '', branch: '', levels: [], weeklyHours: '1', distributionPattern: '' });
    setEditingSubject(null);
    setIsModalOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.levels.length === 0) { error('Eğitim Seviyesi Gerekli'); return; }

    const weeklyHours = parseInt(formData.weeklyHours) || 1;
    if (formData.distributionPattern && !validateDistributionPattern(formData.distributionPattern, weeklyHours)) {
      error('Geçersiz Dağıtım Şekli'); return;
    }

    const subjectData = {
      name: formData.name, branch: formData.branch, level: formData.levels[0],
      levels: formData.levels, weeklyHours, distributionPattern: formData.distributionPattern || undefined,
    };

    try {
      if (editingSubject) {
        await updateSubject(editingSubject.id, subjectData);
        success('Ders Güncellendi');
      } else {
        await addSubject(subjectData as Omit<Subject, 'id' | 'createdAt'>);
        success('Ders Eklendi');
      }
      resetForm();
    } catch (_err) { error('Hata'); }
  };

  const handleEdit = (subject: Subject) => {
    setFormData({
      name: subject.name, branch: subject.branch,
      levels: subject.levels || (subject.level ? [subject.level] : []),
      weeklyHours: subject.weeklyHours.toString(),
      distributionPattern: subject.distributionPattern || '',
    });
    setEditingSubject(subject);
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    const subject = allSubjects.find(s => s.id === id);
    if (subject && window.confirm(`${subject.name} dersini silmek istediğinizden emin misiniz?`)) {
      await removeSubject(id);
      success('Silindi');
      if (data.selectedSubjects.includes(id)) {
        handleSubjectToggle(id);
      }
    }
  };

  const handleLevelToggle = (level: 'Anaokulu' | 'İlkokul' | 'Ortaokul') => {
    setFormData(prev => ({ ...prev, levels: prev.levels.includes(level) ? prev.levels.filter(l => l !== level) : [...prev.levels, level] }));
  };

  /*
  const applySuggestion = (suggestion: string) => {
    setFormData(prev => ({ ...prev, distributionPattern: suggestion }));
  };
  */

  const weeklyHours = parseInt(formData.weeklyHours) || 1;
  // Distribution variables computed but not currently displayed
  void generateDistributionSuggestions(weeklyHours);
  void validateDistributionPattern(formData.distributionPattern, weeklyHours);
  void parseDistributionPattern(formData.distributionPattern);

  const allFilteredSelected = filteredSubjects.length > 0 && filteredSubjects.every(s => data.selectedSubjects.includes(s.id));

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="w-16 h-16 bg-ide-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <BookOpen className="w-8 h-8 text-ide-primary-600" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Ders Seçimi ve Önceliklendirme</h3>
        <p className="text-gray-600">Programa dahil edilecek dersleri seçin ve yerleştirme önceliklerini belirleyin.</p>
      </div>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="flex-1">
          <Select
            label="Seviye Filtresi"
            value={selectedLevel}
            onChange={setSelectedLevel}
            options={[{ value: '', label: 'Tüm Seviyeler' }, ...EDUCATION_LEVELS.map(l => ({ value: l, label: l }))]}
          />
        </div>
        <div className="flex-1">
          <Input
            label="Ders Ara"
            placeholder="Ders veya branş ara..."
            value={searchTerm}
            onChange={setSearchTerm}
          />
        </div>
        <div className="mb-4">
          <Button onClick={() => setIsModalOpen(true)} icon={Plus} variant="primary">Yeni Ders Ekle</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-gray-900">Mevcut Dersler ({filteredSubjects.length})</h4>
            {filteredSubjects.length > 0 && (
              <Button onClick={handleSelectAll} icon={allFilteredSelected ? Square : CheckSquare} variant={allFilteredSelected ? "secondary" : "primary"} size="sm">
                {allFilteredSelected ? 'Tümünü Kaldır' : 'Tümünü Seç'}
                {selectedLevel && ` (${selectedLevel})`}
              </Button>
            )}
          </div>
          <div className="bg-gray-50 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
            {filteredSubjects.length > 0 ? (
              <div className="space-y-2">
                {filteredSubjects.map(s => (
                  <div key={s.id} className={`p-3 rounded-lg border-2 transition-all ${data.selectedSubjects.includes(s.id) ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{s.name}</p>
                        <div className="flex items-center space-x-2 text-xs text-gray-600 mt-1 flex-wrap">
                          <span>{s.branch}</span>
                          <span>•</span>
                          <span>{(s.levels || [s.level]).join(', ')}</span>
                          <span>•</span>
                          <span>{s.weeklyHours} sa/h</span>
                          {s.distributionPattern && <span className="inline-flex items-center px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full"><Clock className="w-3 h-3 mr-1" />{s.distributionPattern}</span>}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
                        <button onClick={() => handleEdit(s)} className="p-1 text-gray-400 hover:text-blue-600"><Edit size={16} /></button>
                        <button onClick={() => handleDelete(s.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                        <button onClick={() => handleSubjectToggle(s.id)} className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${data.selectedSubjects.includes(s.id) ? 'bg-blue-500 border-blue-500' : 'border-gray-300'}`}>{data.selectedSubjects.includes(s.id) ? <Minus className="w-3 h-3 text-white" /> : <Plus className="w-3 h-3 text-gray-500" />}</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-center text-gray-500 py-8">Bu seviyede ders bulunamadı.</p>}
          </div>
        </div>

        <div>
          <h4 className="font-medium text-gray-900 mb-3">Seçilen Dersler ve Öncelikleri ({selectedSubjects.length})</h4>
          <div className="bg-white rounded-lg border border-gray-200 p-4 max-h-[60vh] overflow-y-auto">
            {selectedSubjects.length > 0 ? (
              <div className="space-y-3">
                {selectedSubjects.map(s => {
                  const priority = data.subjectPriorities[s.id] || 'medium';
                  const priorityStyles = {
                    high: { bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-300', ring: 'ring-red-200' },
                    medium: { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-300', ring: 'ring-blue-200' },
                    low: { bg: 'bg-gray-100', text: 'text-gray-800', border: 'border-gray-300', ring: 'ring-gray-200' },
                  };
                  const style = priorityStyles[priority];

                  return (
                    <div key={s.id} className={`p-3 rounded-lg border-2 ${style.bg} ${style.border}`}>
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium text-sm">{s.name}</p>
                          <p className="text-xs text-gray-600">{s.branch} • {data.subjectHours[s.id] || s.weeklyHours} sa/h</p>
                        </div>
                        <button onClick={() => handleSubjectToggle(s.id)} className="text-red-500 hover:text-red-700 p-1" title="Seçimi kaldır"><Minus className="w-4 h-4" /></button>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">Öncelik</label>
                        <div className="flex items-center space-x-1">
                          {(['high', 'medium', 'low'] as const).map(p => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => handlePriorityChange(s.id, p)}
                              className={`px-3 py-1 text-xs rounded-full font-semibold border transition-all ${priority === p
                                ? `${style.bg} ${style.text} ${style.border} ring-2 ring-offset-1 ${style.ring}`
                                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                                }`}
                            >
                              <Star className={`w-3 h-3 mr-1.5 inline-block ${priority === p ? 'fill-current' : ''}`} />
                              {p === 'high' ? 'Yüksek' : p === 'medium' ? 'Orta' : 'Düşük'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-center text-gray-500 py-8">Sol taraftan ders seçin.</p>}
          </div>
        </div>
      </div>

      <Modal isOpen={isModalOpen} onClose={resetForm} title={editingSubject ? 'Ders Düzenle' : 'Yeni Ders Ekle'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Ders Adı" value={formData.name} onChange={v => setFormData(p => ({ ...p, name: v }))} required />
            <Input label="Branş" value={formData.branch} onChange={v => setFormData(p => ({ ...p, branch: v }))} required />
          </div>
          <Input
            label="Haftalık Ders Saati"
            type="number"
            value={formData.weeklyHours}
            onChange={v => setFormData(p => ({ ...p, weeklyHours: v, distributionPattern: '' }))}
            required
          />
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-2">Dağıtım Şekli <span className="text-gray-500">(İsteğe bağlı)</span></label>
            <Input label="Dağıtım Şekli" value={formData.distributionPattern} onChange={v => setFormData(p => ({ ...p, distributionPattern: v }))} placeholder="Örn: 2+2+1" />
            {!validateDistributionPattern(formData.distributionPattern, parseInt(formData.weeklyHours)) && formData.distributionPattern && (
              <p className="text-xs text-red-600 mt-1">Dağıtım toplamı haftalık saat ile uyuşmuyor!</p>
            )}
          </div>
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-800 mb-2">Eğitim Seviyeleri<span className="text-red-500">*</span></label>
            <div className="flex flex-wrap gap-3">
              {EDUCATION_LEVELS.map(level => (
                <label key={level} className={`flex items-center p-3 border-2 rounded-lg cursor-pointer ${formData.levels.includes(level) ? 'bg-ide-primary-50 border-ide-primary-500' : 'bg-white border-gray-300'}`}>
                  <input type="checkbox" checked={formData.levels.includes(level)} onChange={() => handleLevelToggle(level)} className="sr-only" />
                  <span className="text-sm font-medium">{level}</span>
                  {formData.levels.includes(level) && <span className="ml-2 text-ide-primary-600">✓</span>}
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end space-x-3 pt-4">
            <Button type="button" onClick={resetForm} variant="secondary">İptal</Button>
            <Button type="submit" variant="primary" disabled={formData.levels.length === 0}>
              {editingSubject ? 'Güncelle' : 'Kaydet'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default WizardStepSubjects;
// --- END OF FILE src/pages/WizardStepSubjects.tsx ---