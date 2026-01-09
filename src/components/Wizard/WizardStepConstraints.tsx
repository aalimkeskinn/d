import React, { useState } from 'react';
import { Clock, User, Building, BookOpen, AlertCircle, CheckCircle2, Pin } from 'lucide-react';
import { Teacher, Class, Subject } from '../../types';
import { WizardData, FixedSlot } from '../../types/wizard';
import { TimeConstraint } from '../../types/constraints';
import SearchableSelect from '../UI/SearchableSelect';
import TimeConstraintGrid from '../Constraints/TimeConstraintGrid';
import FixedSlotEditor from '../Constraints/FixedSlotEditor';
import { useToast } from '../../hooks/useToast';
import { normalizeId } from '../../utils/idUtils';

function getEntityLevel(entity: Teacher | Class | Subject | null): 'Anaokulu' | 'İlkokul' | 'Ortaokul' | undefined {
  if (!entity) return undefined;
  return (entity as any).levels?.[0] || (entity as any).level || undefined;
}

interface WizardStepConstraintsProps {
  data: WizardData;
  onUpdate: (data: { constraints: WizardData['constraints'] }) => void;
  teachers: Teacher[];
  classes: Class[];
  subjects: Subject[];
}

const WizardStepConstraints: React.FC<WizardStepConstraintsProps> = ({
  data,
  onUpdate,
  teachers,
  classes,
  subjects
}) => {
  useToast(); // Hook call kept for potential future use
  const [activeTab, setActiveTab] = useState<'teacher' | 'class' | 'subject' | 'fixed'>('teacher');
  const [selectedEntityId, setSelectedEntityId] = useState<string>('');


  const getEntityOptions = () => {
    let options: { value: string; label: string }[] = [];

    switch (activeTab) {
      case 'teacher':
        options = teachers
          .filter(t => data.teachers?.selectedTeachers.includes(t.id))
          .map(t => ({ value: t.id, label: `${t.name} (${t.branch})` }));
        break;
      case 'class':
        options = classes
          .filter(c => data.classes?.selectedClasses.includes(c.id))
          .map(c => ({ value: c.id, label: `${c.name} (${(c.levels || [c.level]).join(', ')})` }));
        break;
      case 'subject':
        options = subjects
          .filter(s => data.subjects?.selectedSubjects.includes(s.id))
          .map(s => {
            const branchStr = s.branch && s.branch !== s.name ? ` ${s.branch}` : '';
            const classStr = s.className ? ` ${s.className}` : '';

            const label = `${s.name}${classStr}${branchStr}`;

            return { value: s.id, label: label.replace(/\s+/g, ' ').trim() };
          });
        break;
    }

    // Alphabetical Sorting
    options.sort((a, b) => a.label.localeCompare(b.label, 'tr'));



    return options;
  };

  const getSelectedEntity = () => {
    if (!selectedEntityId) return null;
    switch (activeTab) {
      case 'teacher': return teachers.find(t => t.id === selectedEntityId);
      case 'class': return classes.find(c => c.id === selectedEntityId);
      case 'subject': return subjects.find(s => s.id === selectedEntityId);
      default: return null;
    }
  };

  const handleConstraintsUpdate = (newConstraints: TimeConstraint[]) => {
    onUpdate({
      constraints: {
        ...(data.constraints || { timeConstraints: [], fixedSlots: [], globalRules: {} as any }),
        timeConstraints: newConstraints,
      },
    });
  };

  const handleFixedSlotsUpdate = (newFixedSlots: FixedSlot[]) => {
    onUpdate({
      constraints: {
        ...(data.constraints || { timeConstraints: [], fixedSlots: [], globalRules: {} as any }),
        fixedSlots: newFixedSlots,
      },
    });
  };

  const currentSelectedEntityObject = getSelectedEntity();
  let entityName = currentSelectedEntityObject?.name || '';

  // Improved name for subject constraints: "Subject Class Branch"
  if (activeTab === 'subject' && currentSelectedEntityObject) {
    const s = currentSelectedEntityObject as Subject;
    const branchStr = s.branch && s.branch !== s.name ? ` ${s.branch}` : '';
    const classStr = s.className ? ` ${s.className}` : '';

    entityName = `${s.name}${classStr}${branchStr}`.replace(/\s+/g, ' ').trim();
  }

  const entityLevel = currentSelectedEntityObject ? getEntityLevel(currentSelectedEntityObject as any) : 'Ortaokul';

  const tabs = [
    { id: 'teacher', label: 'Öğretmenler', icon: User },
    { id: 'class', label: 'Sınıflar', icon: Building },
    { id: 'subject', label: 'Dersler', icon: BookOpen },
    { id: 'fixed', label: 'Sabit Dersler', icon: Pin }
  ];

  // FIX: Find the active tab info to use for labels
  const activeTabInfo = tabs.find(t => t.id === activeTab);

  return (
    <div className="space-y-6">
      <div className="text-center">
        <Clock className="w-12 h-12 text-ide-primary-600 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Zaman Kısıtlamaları</h2>
        <p className="text-gray-600">Öğretmen, sınıf veya ders bazında müsait olunmayan zamanları belirleyin.</p>
      </div>

      {/* --- INFRASTRUCTURE: Constraints Audit Report --- */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-ide-primary-50 rounded-lg">
            <Clock className="w-5 h-5 text-ide-primary-600" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-900">Kısıtlama Durum Özeti</h4>
            <p className="text-xs text-gray-500">Sistemdeki kısıtlamaların güncel verilerle uyumu</p>
          </div>
        </div>

        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-sm font-medium text-gray-700">
              {(() => {
                const tc = data.constraints?.timeConstraints || [];
                const validIds = new Set([
                  ...teachers.map(t => t.id),
                  ...classes.map(c => c.id),
                  ...subjects.map(s => s.id)
                ]);
                const active = tc.filter(c => validIds.has(normalizeId(c.entityId, c.entityType as any))).length;
                return `${active} Aktif`;
              })()}
            </span>
          </div>

          {(() => {
            const tc = data.constraints?.timeConstraints || [];
            const validIds = new Set([
              ...teachers.map(t => t.id),
              ...classes.map(c => c.id),
              ...subjects.map(s => s.id)
            ]);
            const orphans = tc.filter(c => !validIds.has(normalizeId(c.entityId, c.entityType as any))).length;
            if (orphans > 0) {
              return (
                <div className="flex items-center space-x-2 px-3 py-1 bg-amber-50 rounded-full border border-amber-200 animate-pulse">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-bold text-amber-700">
                    {orphans} Sahipsiz (Uyumsuz)
                  </span>
                </div>
              );
            }
            return null;
          })()}
        </div>
      </div>
      {/* --- END AUDIT REPORT --- */}

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as any);
                setSelectedEntityId('');
              }}
              className={`py-2 px-1 border-b-2 font-medium text-sm flex items-center transition-colors duration-200 ${activeTab === tab.id
                ? 'border-ide-primary-500 text-ide-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              <tab.icon className="w-4 h-4 mr-2" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6">
        {activeTab === 'fixed' ? (
          /* Sabit Dersler Sekmesi */
          <FixedSlotEditor
            teachers={teachers}
            classes={classes}
            subjects={subjects}
            fixedSlots={data.constraints?.fixedSlots || []}
            onSave={handleFixedSlotsUpdate}
          />
        ) : (
          /* Öğretmen/Sınıf/Ders Kısıtlamaları */
          <>
            <div className="md:col-span-2">
              <SearchableSelect
                label={`${activeTabInfo?.label || 'Öğe'} Seçin`}
                placeholder={`${activeTabInfo?.label || 'Öğe'} ara veya seç...`}
                value={selectedEntityId}
                onChange={setSelectedEntityId}
                options={getEntityOptions()}
                className="w-full"
              />
            </div>

            {selectedEntityId && currentSelectedEntityObject ? (
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden mt-4">
                <TimeConstraintGrid
                  entityType={activeTab as any}
                  entityId={selectedEntityId}
                  entityName={entityName}
                  entityLevel={entityLevel}
                  constraints={data.constraints?.timeConstraints || []}
                  onSave={handleConstraintsUpdate}
                />
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed mt-4">
                <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                  {React.createElement(activeTabInfo?.icon || Clock, { className: "w-8 h-8 text-gray-400" })}
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">Öğe Seçin</h3>
                <p className="text-gray-500 max-w-md mx-auto">
                  Zaman kısıtlamalarını düzenlemek için yukarıdaki listeden bir {activeTabInfo?.label.toLowerCase() || 'öğe'} seçin.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default WizardStepConstraints;
