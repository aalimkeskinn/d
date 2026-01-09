import React, { useState, useEffect, useMemo } from 'react';
import { Clock, RotateCcw, Lock, Slash, Settings } from 'lucide-react';
import { DAYS, formatTimeRange, getTimePeriods } from '../../types';
import { TimeConstraint, CONSTRAINT_TYPES, ConstraintType } from '../../types/constraints';
import Button from '../UI/Button';

interface TimeConstraintGridProps {
  entityType: 'teacher' | 'class' | 'subject';
  entityId: string;
  entityName: string;
  entityLevel?: 'Anaokulu' | 'İlkokul' | 'Ortaokul';
  constraints: TimeConstraint[];
  onSave: (newConstraints: TimeConstraint[]) => void;
}

const TimeConstraintGrid: React.FC<TimeConstraintGridProps> = ({
  entityType,
  entityId,
  entityName,
  entityLevel,
  constraints,
  onSave,
}) => {
  const [selectedConstraintType, setSelectedConstraintType] = useState<ConstraintType>('unavailable');
  const [localConstraints, setLocalConstraints] = useState<TimeConstraint[]>([]);

  useEffect(() => {
    setLocalConstraints(constraints);
  }, [entityId, constraints]);

  const timePeriodsToRender = useMemo(() => {
    const level = entityLevel || 'İlkokul';
    return getTimePeriods(level);
  }, [entityLevel]);

  const updateLocalConstraints = (newConstraints: TimeConstraint[]) => {
    setLocalConstraints(newConstraints);
    onSave(newConstraints);
  };

  const handleSetAll = (type: ConstraintType) => {
    const newConstraints = localConstraints.filter(c => c.entityId !== entityId);
    if (type !== 'preferred') {
      timePeriodsToRender.forEach(tp => {
        if (!tp.isBreak) {
          DAYS.forEach(day => {
            newConstraints.push({
              id: `${entityId}-${day}-${tp.period}-${Date.now()}`,
              entityType, entityId, day, period: tp.period,
              constraintType: type,
              reason: `Toplu atama: ${CONSTRAINT_TYPES[type].label}`,
              createdAt: new Date(), updatedAt: new Date()
            });
          });
        }
      });
    }
    updateLocalConstraints(newConstraints);
  };

  const handleReset = () => {
    const freshConstraints = localConstraints.filter(c => c.entityId !== entityId);
    setLocalConstraints(freshConstraints);
    onSave(freshConstraints);
  };

  const handleSlotClick = (day: string, period: string, isFixed: boolean) => {
    if (isFixed) return;

    const updatedConstraints = [...localConstraints];
    const existingConstraintIndex = updatedConstraints.findIndex(c => c.entityType === entityType && c.entityId === entityId && c.day === day && c.period === period);

    if (existingConstraintIndex !== -1) {
      const currentConstraint = updatedConstraints[existingConstraintIndex];
      if (currentConstraint.constraintType === selectedConstraintType) {
        updatedConstraints.splice(existingConstraintIndex, 1);
      } else {
        updatedConstraints[existingConstraintIndex] = { ...currentConstraint, constraintType: selectedConstraintType, updatedAt: new Date() };
      }
    } else {
      const newConstraint: TimeConstraint = {
        id: `${entityId}-${day}-${period}-${Date.now()}`,
        entityType, entityId, day, period,
        constraintType: selectedConstraintType,
        reason: `${CONSTRAINT_TYPES[selectedConstraintType].label} - ${entityName}`,
        createdAt: new Date(), updatedAt: new Date()
      };
      updatedConstraints.push(newConstraint);
    }
    updateLocalConstraints(updatedConstraints);
  };

  const getConstraintForSlot = (day: string, period: string): TimeConstraint | undefined => {
    return localConstraints.find(c => c.entityType === entityType && c.entityId === entityId && c.day === day && c.period === period);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header - Premium Design */}
      <div className="bg-gradient-to-r from-purple-600 to-purple-700 px-4 py-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-white">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Settings className="w-4 h-4" />
              {entityName} - Zaman Kısıtlamaları
            </h3>
            <p className="text-xs text-white/80 mt-0.5">Bir kısıtlama türü seçip tabloya tıklayarak uygulayın</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => handleSetAll('unavailable')} icon={Slash} variant="secondary" className="!py-1.5 !px-3 !text-xs">
              Tümünü Meşgul
            </Button>
            <Button onClick={handleReset} icon={RotateCcw} variant="secondary" className="!py-1.5 !px-3 !text-xs !bg-white !text-purple-700 hover:!bg-purple-50">
              Sıfırla
            </Button>
          </div>
        </div>
      </div>

      {/* Constraint Type Selector */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="text-xs font-semibold text-gray-600 whitespace-nowrap">Kısıtlama Türü:</span>
          <div className="flex flex-wrap gap-2">
            {Object.entries(CONSTRAINT_TYPES).map(([key, value]) => (
              <button
                key={key}
                onClick={() => setSelectedConstraintType(key as ConstraintType)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all ${selectedConstraintType === key
                  ? `${value.color} border-current shadow-sm`
                  : 'border-gray-200 bg-white hover:bg-gray-50 text-gray-600'
                  }`}
              >
                <span>{value.icon}</span>
                <span>{value.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Constraint Grid - Compact Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr className="bg-gray-100">
              <th className="w-24 px-2 py-2 text-[10px] font-bold text-gray-700 uppercase border border-gray-300 bg-gray-100 text-center">
                Saat
              </th>
              {DAYS.map(day => (
                <th key={day} className="px-1 py-2 text-[10px] font-bold text-gray-700 uppercase border border-gray-300 bg-gray-100 text-center">
                  {day.substring(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timePeriodsToRender.map((tp) => {
              const isFixed = tp.isBreak;
              const periodLabel = typeof tp.period === 'string' && tp.period.startsWith('break')
                ? 'Mola'
                : tp.isBreak
                  ? 'Mola'
                  : `${tp.period}. Ders`;

              return (
                <tr key={tp.period} className={isFixed ? 'bg-gray-50' : 'bg-white'}>
                  <td className={`px-2 py-1.5 border border-gray-300 ${isFixed ? 'bg-yellow-100' : 'bg-gray-50'}`}>
                    <div className="text-center">
                      <div className="font-bold text-[10px] text-gray-800">{periodLabel}</div>
                      <div className="text-[9px] text-gray-500 flex items-center justify-center gap-0.5 mt-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {formatTimeRange(tp.startTime, tp.endTime)}
                      </div>
                    </div>
                  </td>
                  {DAYS.map(day => {
                    if (isFixed) {
                      return (
                        <td key={`${day}-${tp.period}`} className="px-0.5 py-0.5 border border-gray-300 bg-yellow-50">
                          <div className="h-10 flex flex-col items-center justify-center text-gray-400">
                            <Lock size={12} />
                            <span className="text-[8px] mt-0.5">Mola</span>
                          </div>
                        </td>
                      );
                    }
                    const constraint = getConstraintForSlot(day, tp.period);
                    const constraintConfig = constraint ? CONSTRAINT_TYPES[constraint.constraintType] : CONSTRAINT_TYPES.preferred;

                    return (
                      <td key={`${day}-${tp.period}`} className="px-0.5 py-0.5 border border-gray-300">
                        <button
                          onClick={() => handleSlotClick(day, tp.period, isFixed || false)}
                          disabled={isFixed}
                          className={`w-full h-10 rounded transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-purple-400 ${constraintConfig.color} ${isFixed ? 'cursor-not-allowed' : 'hover:opacity-80 active:scale-95'}`}
                        >
                          <div className="flex flex-col items-center justify-center">
                            <span className="text-sm">{constraintConfig.icon}</span>
                            <span className="text-[8px] font-medium leading-tight">{constraintConfig.label}</span>
                          </div>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TimeConstraintGrid;