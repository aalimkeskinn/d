import React, { useState, useRef, useEffect } from 'react';
import { Building, Calendar, Users, BookOpen, Download, Filter, Trash2 } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { Teacher, Class, Subject, DAYS, PERIODS, getTimeForPeriod, formatTimeRange } from '../types';
import { useGlobalData } from '../hooks/useGlobalData';
import { useToast } from '../hooks/useToast';
import { useConfirmation } from '../hooks/useConfirmation';
import Button from '../components/UI/Button';
import ConfirmationModal from '../components/UI/ConfirmationModal';
import ClassSchedulePrintView from '../components/UI/ClassSchedulePrintView';
import PageSkeleton from '../components/UI/PageSkeleton';

const ClassSchedules = () => {
  const location = useLocation();
  const {
    teachers,
    classes,
    subjects,
    schedules,
    loading: isLoading,
    removeSchedule
  } = useGlobalData();
  const { success, error, warning } = useToast();
  const {
    confirmation,
    hideConfirmation,
    confirmDelete
  } = useConfirmation();

  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedLevel, setSelectedLevel] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const printRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Check for classId in URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const classIdFromUrl = urlParams.get('classId');
    if (classIdFromUrl && classes.length > 0) {
      const classExists = classes.find(c => c.id === classIdFromUrl);
      if (classExists) {
        setSelectedClassId(classIdFromUrl);
      }
    }
  }, [location.search, classes]);

  const sortedClasses = [...classes].sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  // DEBUG: Firebase'den yüklenen schedule'ların toplam slot sayısını logla
  useEffect(() => {
    if (!isLoading && schedules.length > 0) {
      let totalSlots = 0;
      const slotsByClass: Record<string, number> = {};
      schedules.forEach(schedule => {
        Object.values(schedule.schedule || {}).forEach((day: any) => {
          Object.values(day || {}).forEach((slot: any) => {
            if (slot && slot.classId) {
              totalSlots++;
              slotsByClass[slot.classId] = (slotsByClass[slot.classId] || 0) + 1;
            }
          });
        });
      });
      // console.log(`📊 [FIREBASE→UI] ${schedules.length} öğretmen schedule'ı yüklendi, toplam ${totalSlots} slot`);

      // Eksik sınıfları bul
      const expectedHours: Record<string, number> = {};
      classes.forEach(c => {
        if (c.level === 'Ortaokul') expectedHours[c.id] = 44;
        else if (c.level === 'İlkokul') expectedHours[c.id] = 44;
        else expectedHours[c.id] = 30; // Anaokulu tahmini
      });

      let missingClasses = 0;
      Object.entries(expectedHours).forEach(([classId, expected]) => {
        const actual = slotsByClass[classId] || 0;
        if (actual < expected - 5) { // 5 saat tolerans (kulüp vs)
          const className = classes.find(c => c.id === classId)?.name || classId;
          // console.warn(`🔴 [SINIF-EKSIK] ${className}: Beklenen ~${expected}, Gerçek ${actual} (${expected - actual} eksik)`);
          missingClasses++;
        }
      });
      if (missingClasses > 0) {
        console.error(`📊 [ÖZET] ${missingClasses} sınıfta eksik ders var!`);
      }
    }
  }, [schedules, classes, isLoading]);



  const getFilteredClasses = () => {
    return sortedClasses.filter(classItem =>
      !selectedLevel || classItem.level === selectedLevel
    );
  };

  const getClassSchedule = (classId: string) => {
    const classSchedule: { [day: string]: { [period: string]: { teacher: Teacher; subject?: Subject } | null } } = {};

    DAYS.forEach(day => {
      classSchedule[day] = {};
      PERIODS.forEach(period => {
        classSchedule[day][period] = null;

        // Find which teacher has this class at this time
        schedules.forEach(schedule => {
          const slot = schedule.schedule[day]?.[period];
          if (slot?.classId === classId) {
            let teacher = teachers.find(t => t.id === schedule.teacherId);
            const subject = subjects.find(s => s.id === slot.subjectId);

            if (schedule.teacherId === 'KULÜP' || schedule.teacherId.startsWith('kulup-virtual-teacher-') || schedule.teacherId.startsWith('generic-teacher-kulup')) {
              teacher = { id: 'KULÜP', name: 'KULÜP' } as any;
            }

            if (teacher) {
              classSchedule[day][period] = { teacher, subject };
            } else {
              // console.warn(`🔴 [ÖĞRETMEN-YOK] ${classId} ${day} ${period}: teacherId=${schedule.teacherId} bulunamadı!`);
            }
          }
        });
      });
    });

    return classSchedule;
  };

  // Check if a period is fixed (preparation, lunch, or afternoon breakfast)
  const isFixedPeriod = (_day: string, period: string, classLevel?: 'Anaokulu' | 'İlkokul' | 'Ortaokul'): boolean => {
    if (period === 'prep') return true;
    if ((classLevel === 'İlkokul' || classLevel === 'Anaokulu') && period === '5') return true;
    if (classLevel === 'Ortaokul' && period === '6') return true;
    if (period === 'afternoon-breakfast') return true;
    return false;
  };


  // CRITICAL: Düzeltilmiş haftalık ders saati hesaplama
  const calculateWeeklyHours = (classId: string) => {
    let totalHours = 0;
    const classSchedule = getClassSchedule(classId);

    DAYS.forEach(day => {
      PERIODS.forEach(period => {
        // Sabit periyotlar hariç tüm dolu slotları say
        if (classSchedule[day][period] && !isFixedPeriod(day, period)) {
          totalHours++;
        }
      });
    });

    return totalHours;
  };

  const calculateDailyHours = (classId: string, day: string) => {
    let dailyHours = 0;
    const classSchedule = getClassSchedule(classId);

    PERIODS.forEach(period => {
      // Sabit periyotlar hariç tüm dolu slotları say
      if (classSchedule[day][period] && !isFixedPeriod(day, period)) {
        dailyHours++;
      }
    });

    return dailyHours;
  };

  const handleViewClass = (classId: string) => {
    const classItem = classes.find(c => c.id === classId);
    if (classItem) {
      // console.log('👁️ Sınıf görüntüleme:', { classId, className: classItem.name });
      // Toggle: same class clicked = close, different class = open that one
      if (selectedClassId === classId) {
        setSelectedClassId('');
      } else {
        setSelectedClassId(classId);
        // Smooth scroll to the card header
        setTimeout(() => {
          const element = document.getElementById(`class-card-${classId}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      }
    }
  };

  // NEW: Delete all class schedules function
  const handleDeleteAllSchedules = () => {
    const classesWithSchedules = filteredClasses.filter(classItem =>
      calculateWeeklyHours(classItem.id) > 0
    );

    if (classesWithSchedules.length === 0) {
      warning('⚠️ Silinecek Program Yok', 'Filtrelenen sınıflar arasında silinecek program bulunamadı');
      return;
    }

    confirmDelete(
      `${classesWithSchedules.length} Sınıf Programı`,
      async () => {
        setIsDeletingAll(true);

        try {
          let deletedCount = 0;

          // Find all schedules that contain these classes
          const schedulesToDelete = schedules.filter(schedule => {
            return Object.values(schedule.schedule).some(day =>
              Object.values(day).some(slot =>
                slot?.classId && classesWithSchedules.some(c => c.id === slot.classId)
              )
            );
          });

          // console.log('🗑️ Silinecek programlar:', {
          //   totalSchedules: schedules.length,
          //   schedulesToDelete: schedulesToDelete.length,
          //   classesWithSchedules: classesWithSchedules.length
          // });

          // Delete each schedule
          for (const schedule of schedulesToDelete) {
            try {
              await removeSchedule(schedule.id);
              deletedCount++;
              // console.log(`✅ Program silindi: ${schedule.id}`);
            } catch (err) {
              console.error(`❌ Program silinemedi: ${schedule.id}`, err);
            }
          }

          if (deletedCount > 0) {
            success('🗑️ Programlar Silindi', `${deletedCount} sınıf programı başarıyla silindi`);

            // Reset selected class if it was deleted
            if (selectedClassId && classesWithSchedules.some(c => c.id === selectedClassId)) {
              setSelectedClassId('');
            }
          } else {
            error('❌ Silme Hatası', 'Hiçbir program silinemedi');
          }

        } catch (err) {
          console.error('❌ Toplu silme hatası:', err);
          error('❌ Silme Hatası', 'Programlar silinirken bir hata oluştu');
        } finally {
          setIsDeletingAll(false);
        }
      }
    );
  };

  const generateSingleClassPDF = async (classItem: Class) => {
    const printElement = printRefs.current[classItem.id];
    if (!printElement) return null;

    try {
      await new Promise(resolve => setTimeout(resolve, 200));

      const canvas = await html2canvas(printElement, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        width: printElement.scrollWidth,
        height: printElement.scrollHeight,
        scrollX: 0,
        scrollY: 0,
        logging: false,
        removeContainer: true,
        imageTimeout: 0
      });

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const imgData = canvas.toDataURL('image/png', 1.0);
      const imgWidth = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const yOffset = imgHeight < 210 ? (210 - imgHeight) / 2 : 0;

      pdf.addImage(imgData, 'PNG', 0, yOffset, imgWidth, imgHeight);
      return pdf;
    } catch (err) {
      console.error(`${classItem.name} için PDF oluşturma hatası:`, err);
      return null;
    }
  };

  const downloadSingleClassPDF = async (classItem: Class) => {
    setIsGenerating(true);

    try {
      const pdf = await generateSingleClassPDF(classItem);
      if (pdf) {
        const className = classItem.name
          .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
          .replace(/ü/g, 'u').replace(/Ü/g, 'U')
          .replace(/ş/g, 's').replace(/Ş/g, 'S')
          .replace(/ı/g, 'i').replace(/İ/g, 'I')
          .replace(/ö/g, 'o').replace(/Ö/g, 'O')
          .replace(/ç/g, 'c').replace(/Ç/g, 'C')
          .replace(/[^a-zA-Z0-9\s]/g, '')
          .replace(/\s+/g, '_');

        const fileName = `${className}_Sinif_Programi_${new Date().getFullYear()}.pdf`;
        pdf.save(fileName);
        success('PDF İndirildi', `${classItem.name} sınıfı programı başarıyla indirildi`);
      } else {
        error('PDF Hatası', 'PDF oluşturulurken bir hata oluştu');
      }
    } catch (err) {
      error('PDF Hatası', 'PDF oluşturulurken bir hata oluştu');
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadAllClassSchedules = async () => {
    const filteredClasses = getFilteredClasses();
    const classesWithSchedules = filteredClasses.filter(classItem =>
      calculateWeeklyHours(classItem.id) > 0
    );

    if (classesWithSchedules.length === 0) {
      error('Program Bulunamadı', 'İndirilecek sınıf programı bulunamadı');
      return;
    }

    setIsGeneratingAll(true);

    try {
      let combinedPdf: jsPDF | null = null;

      for (let i = 0; i < classesWithSchedules.length; i++) {
        const classItem = classesWithSchedules[i];
        const pdf = await generateSingleClassPDF(classItem);

        if (pdf) {
          if (i === 0) {
            combinedPdf = pdf;
          } else if (combinedPdf) {
            combinedPdf.addPage();

            const printElement = printRefs.current[classItem.id];
            if (printElement) {
              await new Promise(resolve => setTimeout(resolve, 100));

              const canvas = await html2canvas(printElement, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: '#ffffff',
                logging: false
              });

              const imgData = canvas.toDataURL('image/png', 1.0);
              const imgWidth = 297;
              const imgHeight = (canvas.height * imgWidth) / canvas.width;
              const yOffset = imgHeight < 210 ? (210 - imgHeight) / 2 : 0;

              combinedPdf.addImage(imgData, 'PNG', 0, yOffset, imgWidth, imgHeight);
            }
          }
        }
      }

      if (combinedPdf) {
        const fileName = `Tum_Sinif_Programlari_${new Date().getFullYear()}.pdf`;
        combinedPdf.save(fileName);
        success('Toplu PDF İndirildi', `${classesWithSchedules.length} sınıf programı başarıyla indirildi`);
      }
    } catch (err) {
      error('PDF Hatası', 'Toplu PDF oluşturulurken bir hata oluştu');
    } finally {
      setIsGeneratingAll(false);
    }
  };

  const filteredClasses = getFilteredClasses();
  const classesWithSchedules = filteredClasses.filter(classItem =>
    calculateWeeklyHours(classItem.id) > 0
  );

  // Show skeleton while any data is loading
  if (isLoading) {
    return <PageSkeleton type="table" />;
  }

  return (
    <div className="container-mobile">
      {/* FIXED: Mobile-optimized header with consistent spacing */}
      <div className="header-mobile">
        <div className="flex items-center">
          <Building className="w-8 h-8 text-emerald-600 mr-3" />
          <div>
            <h1 className="text-responsive-xl font-bold text-gray-900">Sınıf Ders Programları</h1>
            <p className="text-responsive-sm text-gray-600">Sınıf bazında ders programlarını görüntüleyin</p>
          </div>
        </div>
        <div className="button-group-mobile">
          {/* Delete All Button */}
          {classesWithSchedules.length > 0 && (
            <Button
              onClick={handleDeleteAllSchedules}
              icon={Trash2}
              variant="danger"
              disabled={isDeletingAll}
              className="w-full sm:w-auto"
            >
              {isDeletingAll ? 'Siliniyor...' : `Tüm Programları Sil (${classesWithSchedules.length})`}
            </Button>
          )}

          <Button
            onClick={downloadAllClassSchedules}
            icon={Download}
            variant="primary"
            disabled={classesWithSchedules.length === 0 || isGeneratingAll}
            className="w-full sm:w-auto"
          >
            {isGeneratingAll ? 'PDF Oluşturuluyor...' : `Tüm Programları İndir (${classesWithSchedules.length})`}
          </Button>
        </div>
      </div>

      {/* Filters and Class Selection - Premium Design */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 overflow-hidden">
        {/* Header Bar */}
        <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 px-4 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-white/80" />
              <span className="text-sm font-medium text-white">Sınıf Seç ve Filtrele</span>
            </div>
            {selectedClassId && (
              <span className="text-xs bg-white/20 text-white px-2.5 py-1 rounded-full backdrop-blur-sm">
                {filteredClasses.length} sınıf
              </span>
            )}
          </div>
        </div>

        {/* Filter Controls */}
        <div className="p-4 bg-gray-50/50">
          <div className="flex flex-col lg:flex-row gap-3">

            {/* Level Filter */}
            <div className="flex items-center gap-1 bg-white border-2 border-gray-200 rounded-xl px-3 py-2 hover:border-emerald-300 transition-colors flex-1 lg:flex-none lg:w-48">
              <Building className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <select
                value={selectedLevel}
                onChange={(e) => setSelectedLevel(e.target.value)}
                className="bg-transparent text-sm text-gray-700 font-medium focus:outline-none cursor-pointer flex-1 pr-1"
              >
                <option value="">Tüm Kademeler</option>
                <option value="Anaokulu">Anaokulu</option>
                <option value="İlkokul">İlkokul</option>
                <option value="Ortaokul">Ortaokul</option>
              </select>
            </div>

            {/* Class Selection */}
            <div className="flex items-center gap-1 bg-white border-2 border-gray-200 rounded-xl px-3 py-2 hover:border-blue-300 transition-colors flex-1">
              <BookOpen className="w-4 h-4 text-blue-500 flex-shrink-0" />
              <select
                value={selectedClassId}
                onChange={(e) => {
                  // console.log('🔄 Sınıf değiştirildi:', { oldClass: selectedClassId, newClass: e.target.value });
                  setSelectedClassId(e.target.value);
                }}
                className="bg-transparent text-sm text-gray-700 font-medium focus:outline-none cursor-pointer flex-1 pr-1"
              >
                <option value="">Sınıf Seçiniz...</option>
                {filteredClasses.map(classItem => (
                  <option key={classItem.id} value={classItem.id}>
                    {classItem.name} ({classItem.level})
                  </option>
                ))}
              </select>
            </div>

          </div>
        </div>

        {/* Active Selection Bar */}
        {(selectedLevel || selectedClassId) && (
          <div className="px-4 py-2.5 bg-emerald-50/50 border-t border-emerald-100 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 mr-1">Seçili:</span>

            {selectedLevel && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-emerald-100 text-emerald-700 pl-2.5 pr-1.5 py-1 rounded-full font-medium">
                <Building className="w-3 h-3" /> {selectedLevel}
                <button onClick={() => setSelectedLevel('')} className="hover:bg-emerald-200 p-0.5 rounded-full transition-colors">
                  <span className="text-xs">×</span>
                </button>
              </span>
            )}
            {selectedClassId && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-blue-100 text-blue-700 pl-2.5 pr-1.5 py-1 rounded-full font-medium">
                <BookOpen className="w-3 h-3" /> {filteredClasses.find(c => c.id === selectedClassId)?.name}
                <button onClick={() => setSelectedClassId('')} className="hover:bg-blue-200 p-0.5 rounded-full transition-colors">
                  <span className="text-xs">×</span>
                </button>
              </span>
            )}

            <button
              onClick={() => { setSelectedLevel(''); setSelectedClassId(''); }}
              className="ml-auto text-xs text-red-600 hover:text-red-700 font-medium hover:bg-red-50 px-2 py-1 rounded-lg transition-colors"
            >
              Temizle
            </button>
          </div>
        )}
      </div>

      {/* Statistics */}
      <div className="responsive-grid gap-responsive mb-6">
        <div className="mobile-card mobile-spacing">
          <div className="flex items-center">
            <Building className="w-8 h-8 text-emerald-600 mr-3" />
            <div>
              <p className="text-sm text-gray-600">Toplam Sınıf</p>
              <p className="text-2xl font-bold text-gray-900">{classes.length}</p>
            </div>
          </div>
        </div>
        <div className="mobile-card mobile-spacing">
          <div className="flex items-center">
            <Calendar className="w-8 h-8 text-blue-600 mr-3" />
            <div>
              <p className="text-sm text-gray-600">Programlı Sınıf</p>
              <p className="text-2xl font-bold text-gray-900">{classesWithSchedules.length}</p>
            </div>
          </div>
        </div>
        <div className="mobile-card mobile-spacing">
          <div className="flex items-center">
            <Users className="w-8 h-8 text-ide-primary-600 mr-3" />
            <div>
              <p className="text-sm text-gray-600">Aktif Öğretmen</p>
              <p className="text-2xl font-bold text-gray-900">{teachers.length}</p>
            </div>
          </div>
        </div>
        <div className="mobile-card mobile-spacing">
          <div className="flex items-center">
            <BookOpen className="w-8 h-8 text-ide-primary-600 mr-3" />
            <div>
              <p className="text-sm text-gray-600">Toplam Ders</p>
              <p className="text-2xl font-bold text-gray-900">{subjects.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* All Classes Overview */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900 flex items-center">
            <Filter className="w-6 h-6 mr-2 text-emerald-600" />
            Tüm Sınıf Programları
          </h2>
          <p className="text-sm text-gray-600">
            {filteredClasses.length} sınıf • {classesWithSchedules.length} programlı
          </p>
        </div>

        {filteredClasses.map(classItem => {
          const weeklyHours = calculateWeeklyHours(classItem.id);
          const isSelected = selectedClassId === classItem.id;

          return (
            <div key={classItem.id}
              id={`class-card-${classItem.id}`}
              className={`mobile-card mobile-spacing hover:shadow-md transition-shadow scroll-mt-20 ${isSelected ? 'ring-2 ring-emerald-500 shadow-lg' : ''
                }`}>
              <div className="p-4 bg-gray-50 border-b">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${weeklyHours > 0 ? 'bg-emerald-500' : 'bg-gray-300'
                      }`} />
                    <div>
                      <h3 className="font-bold text-gray-900 text-lg">
                        {classItem.name}
                      </h3>
                      <div className="flex items-center space-x-4 mt-1">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${classItem.level === 'Anaokulu' ? 'bg-green-100 text-green-800' :
                          classItem.level === 'İlkokul' ? 'bg-blue-100 text-blue-800' :
                            'bg-ide-primary-100 text-ide-accent-800'
                          }`}>
                          {classItem.level}
                        </span>
                        <span className="text-sm text-gray-600">
                          {weeklyHours > 0 ? `${weeklyHours} ders saati` : 'Program yok'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {weeklyHours > 0 ? (
                      <>
                        <Button
                          onClick={() => handleViewClass(classItem.id)}
                          variant={isSelected ? "primary" : "secondary"}
                          size="sm"
                        >
                          {isSelected ? 'Görüntüleniyor' : 'Görüntüle'}
                        </Button>
                        <Button
                          onClick={() => downloadSingleClassPDF(classItem)}
                          icon={Download}
                          variant="primary"
                          size="sm"
                          disabled={isGenerating}
                        >
                          PDF İndir
                        </Button>
                      </>
                    ) : (
                      <span className="inline-flex px-3 py-2 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                        Program Yok
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Inline Schedule - Accordion Style (AllSchedules-compatible design) */}
              {isSelected && weeklyHours > 0 && (() => {
                const getTimeInfo = (period: string, level?: 'Anaokulu' | 'İlkokul' | 'Ortaokul') => {
                  const timePeriod = getTimeForPeriod(period, level);
                  if (timePeriod) return formatTimeRange(timePeriod.startTime, timePeriod.endTime);
                  return `${period}. Ders`;
                };

                return (
                  <div className="border-t border-emerald-200 bg-white">
                    <div className="p-4 bg-emerald-50">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-bold text-emerald-900 text-lg">
                            📚 {classItem.name} Sınıfı Ders Programı
                          </h3>
                          <p className="text-emerald-700 mt-1">
                            <span className="font-medium">{classItem.level}</span> •
                            <span className="ml-2">Haftalık toplam: <strong>{weeklyHours} ders saati</strong></span>
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="table-responsive schedule-mobile">
                      <table className="min-w-full schedule-table">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-700 uppercase border bg-gray-50 tracking-wider">
                              Dersler
                            </th>
                            <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-700 uppercase border bg-gray-50 tracking-wider">
                              Saatler
                            </th>
                            {DAYS.map(day => (
                              <th key={day} className="px-3 py-2 text-center text-[10px] font-semibold text-gray-700 uppercase border bg-gray-50 tracking-wider">
                                <div>{day}</div>
                                <div className="text-[9px] mt-1">
                                  <span className="inline-flex px-2 py-0.5 text-[9px] font-semibold rounded-full bg-emerald-100 text-emerald-700">
                                    {calculateDailyHours(classItem.id, day)} ders
                                  </span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {/* Preparation Period */}
                          <tr className="bg-yellow-400">
                            <td className="px-3 py-2 font-semibold text-gray-900 border text-xs text-center border-black tracking-wide">
                              {classItem.level === 'Ortaokul' ? 'HAZIRLIK' : 'KAHVALTI'}
                            </td>
                            <td className="px-3 py-2 font-medium text-gray-900 border text-xs text-center border-black whitespace-nowrap">
                              {classItem.level === 'Ortaokul' ? '08:30-08:40' : '08:30-08:50'}
                            </td>
                            <td colSpan={5} className="px-3 py-2 font-semibold text-gray-900 border text-sm text-center border-black tracking-wide">
                              {classItem.level === 'Ortaokul' ? 'HAZIRLIK' : 'KAHVALTI / breakfast (20\')'}
                            </td>
                          </tr>

                          {PERIODS.map(period => {
                            const classSchedule = getClassSchedule(classItem.id);
                            const isLunchPeriod = (
                              (classItem.level === 'İlkokul' || classItem.level === 'Anaokulu') && period === '5'
                            ) || (
                                classItem.level === 'Ortaokul' && period === '6'
                              );
                            const showAfternoonBreakAfter = period === '8';

                            return (
                              <React.Fragment key={period}>
                                <tr className={isLunchPeriod ? 'bg-yellow-400' : ''}>
                                  <td className={`px-3 py-2 font-semibold text-gray-900 text-xs text-center border-black border tracking-wide ${isLunchPeriod ? '' : 'bg-gray-50'}`}>
                                    {isLunchPeriod ? 'YEMEK' : `${period}. DERS`}
                                  </td>
                                  <td className={`px-3 py-2 font-medium text-gray-900 text-xs text-center border-black border whitespace-nowrap ${isLunchPeriod ? '' : 'bg-gray-50'}`}>
                                    {isLunchPeriod
                                      ? (classItem.level === 'İlkokul' || classItem.level === 'Anaokulu' ? '11:50-12:25' : '12:30-13:05')
                                      : getTimeInfo(period, classItem.level)
                                    }
                                  </td>
                                  {isLunchPeriod ? (
                                    <td colSpan={5} className="px-3 py-2 font-semibold text-gray-900 border-black border text-sm text-center tracking-wide">
                                      ÖĞLE YEMEĞİ / LUNCH
                                    </td>
                                  ) : (
                                    DAYS.map(day => {
                                      const slot = classSchedule[day][period];
                                      return (
                                        <td key={`${day}-${period}`} className="px-2 py-2 border-black border">
                                          {slot ? (
                                            <div className="text-center p-2 rounded">
                                              <div className="font-semibold text-gray-900 text-sm">
                                                {slot.teacher.name === 'KULÜP' ? 'KULÜP' : slot.teacher.name.length > 20 ? slot.teacher.name.substring(0, 20) + '...' : slot.teacher.name}
                                              </div>
                                              {slot.teacher.name !== 'KULÜP' && slot.subject?.name && (
                                                <span className="text-xs font-normal text-gray-500">
                                                  ({slot.subject.name})
                                                </span>
                                              )}
                                            </div>
                                          ) : (
                                            <div className="text-center text-gray-300 text-xs">—</div>
                                          )}
                                        </td>
                                      );
                                    })
                                  )}
                                </tr>
                                {showAfternoonBreakAfter && (
                                  <tr className="bg-yellow-400">
                                    <td className="px-3 py-2 font-semibold text-gray-900 border text-xs text-center border-black tracking-wide">
                                      İKİNDİ
                                    </td>
                                    <td className="px-3 py-2 font-medium text-gray-900 border text-xs text-center border-black whitespace-nowrap">
                                      14:35-14:45
                                    </td>
                                    <td colSpan={5} className="px-3 py-2 font-semibold text-gray-900 border text-sm text-center border-black tracking-wide">
                                      İKİNDİ KAHVALTISI / afternoon snack (10')
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
              })()}

              {weeklyHours > 0 && (
                <>
                  {/* Off-screen print view for PDF generation */}
                  <div style={{
                    position: 'absolute',
                    left: '-9999px',
                    top: '-9999px',
                    zIndex: -1,
                    opacity: 0,
                    pointerEvents: 'none'
                  }}>
                    <div
                      ref={el => printRefs.current[classItem.id] = el}
                      data-class-id={classItem.id}
                      style={{
                        transform: 'none',
                        position: 'static'
                      }}
                    >
                      <ClassSchedulePrintView
                        classItem={classItem}
                        schedule={getClassSchedule(classItem.id)}
                        teachers={teachers}
                        subjects={subjects}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {filteredClasses.length === 0 && (
        <div className="text-center py-12 mobile-card">
          <Building className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Sınıf Bulunamadı</h3>
          <p className="text-gray-500 mb-4">Seçilen filtrelere uygun sınıf bulunmuyor</p>
          <Button
            onClick={() => setSelectedLevel('')}
            variant="secondary"
          >
            Filtreleri Temizle
          </Button>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmation.isOpen}
        onClose={hideConfirmation}
        onConfirm={confirmation.onConfirm}
        title={confirmation.title}
        message={confirmation.message}
        type={confirmation.type}
        confirmText={confirmation.confirmText}
        cancelText={confirmation.cancelText}
        confirmVariant={confirmation.confirmVariant}
      />
    </div>
  );
};

export default ClassSchedules;