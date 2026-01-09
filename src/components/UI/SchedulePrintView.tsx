import React from 'react';
import { Teacher, Class, Subject, Schedule, DAYS, PERIODS, getTimeForPeriod, formatTimeRange } from '../../types';

interface SchedulePrintViewProps {
  teacher: Teacher;
  schedule: Schedule;
  subjects: Subject[];
  classes: Class[];
}

const SchedulePrintView: React.FC<SchedulePrintViewProps> = ({
  teacher,
  schedule,
  subjects,
  classes
}) => {
  const getSlotInfo = (day: string, period: string) => {
    const slot = schedule.schedule[day]?.[period];
    if (!slot?.classId) return null;

    if (slot.classId === 'KULÜP' || slot.classId.startsWith('kulup-virtual-class-') || slot.classId.startsWith('generic-class-kulup')) {
      return { classItem: { name: 'KULÜP' }, subjectItem: { name: 'KULÜP' } };
    }

    const classItem = classes.find(c => c.id === slot.classId);
    const subjectItem = subjects.find(s => s.id === slot.subjectId);

    return { classItem, subjectItem };
  };


  const calculateDetailedHours = () => {
    let regular = 0;
    let club = 0;
    DAYS.forEach(day => {
      PERIODS.forEach(period => {
        const slot = schedule.schedule[day]?.[period];
        if (slot?.classId && slot.classId !== 'fixed-period') {
          if (slot.subjectId === 'auto-subject-kulup') club++;
          else regular++;
        }
      });
    });
    return { regular, club };
  };

  // Zaman bilgisini al
  const getTimeInfo = (period: string) => {
    const timePeriod = getTimeForPeriod(period, teacher.level);
    if (timePeriod) {
      return formatTimeRange(timePeriod.startTime, timePeriod.endTime);
    }
    return `${period}. Ders`;
  };

  /* const calculateDetailedHours = () => { ... } is kept if needed, but the UI changes significantly */
  const { regular, club } = calculateDetailedHours();
  const hasClub = club > 0 || teacher.isClubTeacher;

  return (
    <div style={{
      width: '297mm',
      height: '210mm',
      padding: '15mm',
      fontSize: '12px',
      lineHeight: '1.2',
      fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
      backgroundColor: 'white',
      color: '#000000',
      position: 'relative'
    }}>
      {/* Institutional Logo Section */}
      <div style={{ position: 'absolute', top: '15mm', right: '15mm', textAlign: 'right' }}>
        <div style={{ fontWeight: 'bold', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
          <img src="https://cv.ide.k12.tr/images/ideokullari_logo.png" alt="ide okulları" style={{ height: '50px', objectFit: 'contain' }} />
        </div>
      </div>

      {/* Center Header */}
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <p style={{ margin: 0, fontSize: '14px', fontWeight: 'bold', color: '#333' }}>ide okulları</p>
        <p style={{ margin: '4px 0', fontSize: '16px', fontWeight: 'bold' }}>2025 – 2026 Akademik Yılı Haftalık Ders Programı</p>
      </div>

      {/* Info Labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '10px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', columnGap: '20px', rowGap: '4px' }}>
          <div style={{ fontWeight: 'bold', color: '#555', fontSize: '11px' }}>DERS</div>
          <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{teacher.branch.toUpperCase()}</div>
          <div style={{ fontWeight: 'bold', color: '#555', fontSize: '11px' }}>ÖĞRETMEN</div>
          <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{teacher.name.toUpperCase()}</div>
        </div>
        <div style={{ fontSize: '12px', fontWeight: 'bold' }}>
          {new Date().toLocaleDateString('tr-TR')}
        </div>
      </div>

      {/* Schedule Table */}
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        border: '1.5px solid #000'
      }}>
        <thead>
          <tr>
            <th style={{ border: '1.5px solid #000', padding: '6px', backgroundColor: '#fff', width: '100px', fontWeight: 'bold' }}>DERSLER</th>
            <th style={{ border: '1.5px solid #000', padding: '6px', backgroundColor: '#fff', width: '100px', fontWeight: 'bold' }}>SAATLER</th>
            {DAYS.map(day => (
              <th key={day} style={{ border: '1.5px solid #000', padding: '6px', backgroundColor: '#fff', fontWeight: 'bold' }}>{day.toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody style={{ textAlign: 'center' }}>
          {/* Prep/Breakfast Row (Yellow, Full Width) */}
          <tr style={{ backgroundColor: '#FFFF00', height: '30px' }}>
            <td style={{ border: '1.5px solid #000', padding: '6px', fontWeight: 'bold' }}>
              {teacher.level === 'Ortaokul' ? 'HAZIRLIK' : 'KAHVALTI'}
            </td>
            <td style={{ border: '1.5px solid #000', padding: '6px' }}>
              {teacher.level === 'Ortaokul' ? '08.30-08.40' : '08.30-08.50'}
            </td>
            <td colSpan={5} style={{ border: '1.5px solid #000', padding: '6px', fontWeight: 'bold' }}>
              {teacher.level === 'Ortaokul' ? 'HAZIRLIK' : 'KAHVALTI / breakfast (20\')'}
            </td>
          </tr>

          {PERIODS.map((period) => {
            const timeInfo = getTimeInfo(period);
            const isLunchPeriod = (
              (teacher.level === 'İlkokul' || teacher.level === 'Anaokulu') && period === '5'
            ) || (
                teacher.level === 'Ortaokul' && period === '6'
              );

            // Middle School Breakfast after 1st period
            const showBreakfastAfter = teacher.level === 'Ortaokul' && period === '1';
            const showAfternoonBreakAfter = period === '8';

            return (
              <React.Fragment key={period}>
                {/* Regular Lesson Row */}
                <tr style={{ height: '35px' }}>
                  <td style={{ border: '1.5px solid #000', padding: '6px', fontWeight: 'bold', backgroundColor: isLunchPeriod ? '#FFFF00' : 'transparent' }}>
                    {isLunchPeriod ? `5. DERS YEMEK` : `${period}. DERS`}
                  </td>
                  <td style={{ border: '1.5px solid #000', padding: '6px', backgroundColor: isLunchPeriod ? '#FFFF00' : 'transparent' }}>
                    {isLunchPeriod
                      ? (teacher.level === 'İlkokul' || teacher.level === 'Anaokulu' ? '11.50-12.25' : '12.30-13.05')
                      : timeInfo.replace('-', ' . ')
                    }
                  </td>

                  {isLunchPeriod ? (
                    <td colSpan={5} style={{ border: '1.5px solid #000', backgroundColor: '#FFFF00', padding: '6px', fontWeight: 'bold' }}>
                      ÖĞLE YEMEĞİ/LUNCH
                    </td>
                  ) : (
                    DAYS.map(day => {
                      const slotInfo = getSlotInfo(day, period);
                      const isKulup = slotInfo?.classItem?.name === 'KULÜP' || slotInfo?.classItem?.name?.includes('KULÜP');

                      return (
                        <td key={`${day}-${period}`} style={{
                          border: '1.5px solid #000',
                          padding: '6px',
                          backgroundColor: isKulup ? '#f0f0f0' : 'transparent',
                          backgroundImage: isKulup ? 'radial-gradient(#999 0.5px, transparent 0.5px)' : 'none',
                          backgroundSize: isKulup ? '3px 3px' : 'none'
                        }}>
                          <div style={{ fontWeight: 'bold', fontSize: '11px' }}>
                            {slotInfo?.classItem?.name || ''}
                            {slotInfo?.subjectItem && slotInfo.subjectItem.name !== 'KULÜP' && (
                              <span style={{ fontWeight: 'normal', color: '#666', fontSize: '10px', marginLeft: '4px' }}>
                                ({slotInfo.subjectItem.name})
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })
                  )}
                </tr>

                {/* MS Breakfast Row */}
                {showBreakfastAfter && (
                  <tr style={{ backgroundColor: '#FFFF00', height: '30px' }}>
                    <td style={{ border: '1.5px solid #000', padding: '6px', fontWeight: 'bold' }}>KAHVALTI</td>
                    <td style={{ border: '1.5px solid #000', padding: '6px' }}>09.15-09.35</td>
                    <td colSpan={5} style={{ border: '1.5px solid #000', padding: '6px', fontWeight: 'bold' }}>KAHVALTI / breakfast (20')</td>
                  </tr>
                )}

                {/* Afternoon Break Row */}
                {showAfternoonBreakAfter && (
                  <tr style={{ backgroundColor: '#FFFF00', height: '30px' }}>
                    <td style={{ border: '1.5px solid #000', padding: '6px', fontWeight: 'bold' }}>KAHVALTI</td>
                    <td style={{ border: '1.5px solid #000', padding: '6px' }}>14.35-14.45</td>
                    <td colSpan={5} style={{ border: '1.5px solid #000', padding: '6px', fontWeight: 'bold' }}>KAHVALTI / snack (10')</td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      {/* Footer Hours Info (Optional based on user's new request) */}
      <div style={{ marginTop: '10px', fontSize: '10px', color: '#666', borderTop: '1px dotted #ccc', paddingTop: '4px' }}>
        * Toplam Yük: {regular} Saat {hasClub ? `+ ${club || 2} Kulüp` : ''}
      </div>
    </div>
  );
};

export default SchedulePrintView;