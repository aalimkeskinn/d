import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Users, BookOpen, Building, FileText, Download, Search, X, Trash2, Clock, Edit } from 'lucide-react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { Teacher, Schedule, DAYS, PERIODS, getTimeForPeriod, formatTimeRange } from '../types';
import { useGlobalData } from '../hooks/useGlobalData';
import { useToast } from '../hooks/useToast';
import { useConfirmation } from '../hooks/useConfirmation';
import Button from '../components/UI/Button';
import ConfirmationModal from '../components/UI/ConfirmationModal';
import SchedulePrintView from '../components/UI/SchedulePrintView';
import PageSkeleton from '../components/UI/PageSkeleton';

// Schedule Template interface

const AllSchedules = () => {
  const {
    teachers,
    classes,
    subjects,
    schedules,
    loading: isLoading,
    removeSchedule
  } = useGlobalData();
  const navigate = useNavigate();
  const { success, error, warning } = useToast();
  const {
    confirmation,
    /* showConfirmation, */
    hideConfirmation,
    confirmDelete
  } = useConfirmation();

  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [selectedLevel, setSelectedLevel] = useState('');
  const [selectedDay, setSelectedDay] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const printRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  const handleToggleTeacher = (teacherId: string) => {
    if (selectedTeacherId === teacherId) {
      setSelectedTeacherId('');
    } else {
      setSelectedTeacherId(teacherId);
      // Smooth scroll to the card header
      setTimeout(() => {
        const element = document.getElementById(`teacher-card-${teacherId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    }
  };

  const sortedTeachers = [...teachers].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const _sortedClasses = [...classes].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  // console.log(_sortedClasses);



  const getFilteredTeachers = () => {
    return sortedTeachers.filter(teacher => {
      const matchesLevel = !selectedLevel || teacher.level === selectedLevel;
      // Turkish locale for proper İ/I, Ş/ş, Ğ/ğ, Ü/ü, Ö/ö, Ç/ç handling
      const searchLower = searchQuery.toLocaleLowerCase('tr-TR');
      const matchesSearch = !searchQuery ||
        teacher.name.toLocaleLowerCase('tr-TR').includes(searchLower) ||
        teacher.branch.toLocaleLowerCase('tr-TR').includes(searchLower);

      return matchesLevel && matchesSearch;
    });
  };

  const getTeacherSchedule = (teacherId: string) => {
    return schedules.find(s => s.teacherId === teacherId);
  };

  const getSlotInfo = (teacherId: string, day: string, period: string) => {
    const schedule = getTeacherSchedule(teacherId);
    const slot = schedule?.schedule[day]?.[period];

    if (!slot?.classId) return null;

    if (slot.classId === 'KULÜP' || slot.classId.startsWith('kulup-virtual-class-') || slot.classId.startsWith('generic-class-kulup')) {
      return { classItem: { name: 'KULÜP' }, subjectItem: { name: 'KULÜP' } };
    }

    const classItem = classes.find(c => c.id === slot.classId);
    const subjectItem = subjects.find(s => s.id === slot.subjectId);

    return { classItem, subjectItem };
  };

  // Check if a period is fixed (preparation, lunch, or afternoon breakfast)
  const getClassScheduleForSlot = (day: string, period: string) => {
    const classSchedules: { [classId: string]: { teacher: Teacher } } = {};

    schedules.forEach(schedule => {
      const slot = schedule.schedule[day]?.[period];
      if (slot?.classId && slot.classId !== 'fixed-period') {
        const teacher = teachers.find(t => t.id === schedule.teacherId);

        if (teacher) {
          classSchedules[slot.classId] = { teacher };
        }
      }
    });

    return classSchedules;
  };

  const getConflicts = () => {
    const conflicts: string[] = [];

    DAYS.forEach(day => {
      PERIODS.forEach(period => {
        const classSchedules = getClassScheduleForSlot(day, period);
        const classIds = Object.keys(classSchedules);

        // Check for duplicate class assignments
        const duplicateClasses = classIds.filter((classId, index) =>
          classIds.indexOf(classId) !== index
        );

        duplicateClasses.forEach(classId => {
          const className = classes.find(c => c.id === classId)?.name || 'Bilinmeyen Sınıf';
          conflicts.push(`${day} ${period}. ders: ${className} sınıfı çakışıyor`);
        });
      });
    });

    return [...new Set(conflicts)];
  };

  const getTimeInfo = (period: string, level?: 'Anaokulu' | 'İlkokul' | 'Ortaokul') => {
    const timePeriod = getTimeForPeriod(period, level);
    if (timePeriod) return formatTimeRange(timePeriod.startTime, timePeriod.endTime);
    return `${period}. Ders`;
  };

  // NEW: Delete all teacher schedules function
  const handleDeleteAllSchedules = () => {
    const teachersWithSchedules = filteredTeachers.filter(teacher =>
      schedules.some(s => s.teacherId === teacher.id)
    );

    if (teachersWithSchedules.length === 0) {
      warning('⚠️ Silinecek Program Yok', 'Filtrelenen öğretmenler arasında silinecek program bulunamadı');
      return;
    }

    confirmDelete(
      `${teachersWithSchedules.length} Öğretmen Programı`,
      async () => {
        setIsDeletingAll(true);

        try {
          let deletedCount = 0;

          // Find schedules for filtered teachers
          const schedulesToDelete = schedules.filter(_schedule =>
            teachersWithSchedules.some(teacher => teacher.id === _schedule.teacherId)
          );

          // console.log('🗑️ Silinecek öğretmen programları:', {
          //   totalSchedules: schedules.length,
          //   schedulesToDelete: schedulesToDelete.length,
          //   teachersWithSchedules: teachersWithSchedules.length
          // });

          // Delete each schedule
          for (const schedule of schedulesToDelete) {
            try {
              await removeSchedule(schedule.id);
              deletedCount++;
              // console.log(`✅ Öğretmen programı silindi: ${schedule.id}`);
            } catch (err) {
              console.error(`❌ Program silinemedi: ${schedule.id}`, err);
            }
          }

          if (deletedCount > 0) {
            success('🗑️ Programlar Silindi', `${deletedCount} öğretmen programı başarıyla silindi`);
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

  const generateSingleTeacherPDF = async (teacher: Teacher, _schedule: Schedule) => {
    const printElement = printRefs.current[teacher.id];
    if (!printElement) return null;

    try {
      // Wait for any pending renders
      await new Promise(resolve => setTimeout(resolve, 100));

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
        imageTimeout: 0,
        onclone: (clonedDoc) => {
          // Ensure all styles are properly applied in the cloned document
          const clonedElement = clonedDoc.querySelector('[data-teacher-id="' + teacher.id + '"]');
          if (clonedElement) {
            (clonedElement as HTMLElement).style.transform = 'none';
            (clonedElement as HTMLElement).style.position = 'static';
          }
        }
      });

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const imgData = canvas.toDataURL('image/png', 1.0);
      const imgWidth = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      // Center the image if it's smaller than the page
      const yOffset = imgHeight < 210 ? (210 - imgHeight) / 2 : 0;

      pdf.addImage(imgData, 'PNG', 0, yOffset, imgWidth, imgHeight);
      return pdf;
    } catch (error) {
      console.error(`${teacher.name} için PDF oluşturma hatası:`, error);
      return null;
    }
  };

  const downloadSingleTeacherPDF = async (teacher: Teacher) => {
    const schedule = getTeacherSchedule(teacher.id);
    if (!schedule) return;

    const pdf = await generateSingleTeacherPDF(teacher, schedule);
    if (pdf) {
      const teacherName = teacher.name
        .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
        .replace(/ü/g, 'u').replace(/Ü/g, 'U')
        .replace(/ş/g, 's').replace(/Ş/g, 'S')
        .replace(/ı/g, 'i').replace(/İ/g, 'I')
        .replace(/ö/g, 'o').replace(/Ö/g, 'O')
        .replace(/ç/g, 'c').replace(/Ç/g, 'C')
        .replace(/[^a-zA-Z\s]/g, '')
        .replace(/\s+/g, '_');

      const fileName = `${teacherName}_Ders_Programi_${new Date().getFullYear()}.pdf`;
      pdf.save(fileName);
    }
  };

  const downloadAllSchedules = async () => {
    const teachersWithSchedules = filteredTeachers.filter(teacher =>
      schedules.some(s => s.teacherId === teacher.id)
    );

    if (teachersWithSchedules.length === 0) {
      alert('İndirilecek program bulunamadı');
      return;
    }

    setIsGeneratingAll(true);

    try {
      let combinedPdf: jsPDF | null = null;

      for (let i = 0; i < teachersWithSchedules.length; i++) {
        const teacher = teachersWithSchedules[i];
        const schedule = schedules.find(s => s.teacherId === teacher.id);

        if (schedule) {
          const pdf = await generateSingleTeacherPDF(teacher, schedule);

          if (pdf) {
            if (i === 0) {
              combinedPdf = pdf;
            } else if (combinedPdf) {
              combinedPdf.addPage();

              // Get the image data from the new PDF
              const printElement = printRefs.current[teacher.id];
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
      }

      if (combinedPdf) {
        const fileName = `Tum_Ders_Programlari_${new Date().getFullYear()}.pdf`;
        combinedPdf.save(fileName);
      }
    } catch (error) {
      console.error('Toplu PDF oluşturma hatası:', error);
      alert('PDF oluşturulurken bir hata oluştu');
    } finally {
      setIsGeneratingAll(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
  };

  // ENTER tuşu desteği
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // console.log('🔍 Enter ile öğretmen araması:', searchQuery);
      // Arama zaten otomatik olarak çalışıyor, sadece focus'u kaldır
      const target = e.target as HTMLInputElement;
      target.blur();
    }

    if (e.key === 'Escape') {
      clearSearch();
      const target = e.target as HTMLInputElement;
      target.blur();
    }
  };

  const filteredTeachers = getFilteredTeachers();
  const conflicts = getConflicts();
  const teachersWithSchedules = filteredTeachers.filter(teacher =>
    schedules.some(s => s.teacherId === teacher.id)
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
          <Calendar className="w-8 h-8 text-ide-primary-600 mr-3" />
          <div>
            <h1 className="text-responsive-xl font-semibold text-gray-900">Öğretmen Ders Programları</h1>
            <p className="text-responsive-sm text-gray-600">Okuldaki tüm öğretmen programlarını görüntüleyin</p>
          </div>
        </div>
        <div className="button-group-mobile">
          {/* NEW: Delete All Button */}
          {teachersWithSchedules.length > 0 && (
            <Button
              onClick={handleDeleteAllSchedules}
              icon={Trash2}
              variant="danger"
              disabled={isDeletingAll}
              className="w-full sm:w-auto"
            >
              {isDeletingAll ? 'Siliniyor...' : `Tüm Programları Sil (${teachersWithSchedules.length})`}
            </Button>
          )}

          <Button
            onClick={downloadAllSchedules}
            icon={Download}
            variant="primary"
            disabled={teachersWithSchedules.length === 0 || isGeneratingAll}
            className="w-full sm:w-auto"
          >
            {isGeneratingAll ? 'PDF Oluşturuluyor...' : `Tüm Programları İndir (${teachersWithSchedules.length})`}
          </Button>
        </div>
      </div>

      {/* Search and Filters - Premium Design */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6 overflow-hidden">
        {/* Header Bar */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-white/80" />
              <span className="text-sm font-medium text-white">Öğretmen Ara ve Filtrele</span>
            </div>
            {(searchQuery || selectedLevel || selectedDay || selectedPeriod) && (
              <span className="text-xs bg-white/20 text-white px-2.5 py-1 rounded-full backdrop-blur-sm">
                {filteredTeachers.length} sonuç
              </span>
            )}
          </div>
        </div>

        {/* Filter Controls */}
        <div className="p-4 bg-gray-50/50">
          <div className="flex flex-col lg:flex-row gap-3">

            {/* Search Input - Enhanced */}
            <div className="flex-1 min-w-0">
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="İsim veya branş yazarak arayın..."
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-white border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all shadow-sm hover:border-gray-300"
                />
                {searchQuery && (
                  <button
                    onClick={clearSearch}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-red-500 hover:bg-red-50 p-1 rounded-full transition-all"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Filter Buttons - Enhanced */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-white border-2 border-gray-200 rounded-xl px-3 py-1.5 hover:border-blue-300 transition-colors">
                <Building className="w-4 h-4 text-blue-500" />
                <select
                  value={selectedLevel}
                  onChange={(e) => setSelectedLevel(e.target.value)}
                  className="bg-transparent text-sm text-gray-700 font-medium focus:outline-none cursor-pointer pr-1"
                >
                  <option value="">Kademe</option>
                  <option value="Anaokulu">Anaokulu</option>
                  <option value="İlkokul">İlkokul</option>
                  <option value="Ortaokul">Ortaokul</option>
                </select>
              </div>

              <div className="flex items-center gap-1 bg-white border-2 border-gray-200 rounded-xl px-3 py-1.5 hover:border-emerald-300 transition-colors">
                <Calendar className="w-4 h-4 text-emerald-500" />
                <select
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(e.target.value)}
                  className="bg-transparent text-sm text-gray-700 font-medium focus:outline-none cursor-pointer pr-1"
                >
                  <option value="">Gün</option>
                  <option value="Pazartesi">Pazartesi</option>
                  <option value="Salı">Salı</option>
                  <option value="Çarşamba">Çarşamba</option>
                  <option value="Perşembe">Perşembe</option>
                  <option value="Cuma">Cuma</option>
                </select>
              </div>

              <div className="flex items-center gap-1 bg-white border-2 border-gray-200 rounded-xl px-3 py-1.5 hover:border-orange-300 transition-colors">
                <Clock className="w-4 h-4 text-orange-500" />
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  className="bg-transparent text-sm text-gray-700 font-medium focus:outline-none cursor-pointer pr-1"
                >
                  <option value="">Saat</option>
                  {PERIODS.map(p => <option key={p} value={p}>{p}. Ders</option>)}
                </select>
              </div>
            </div>

          </div>
        </div>

        {/* Active Filters Bar */}
        {(searchQuery || selectedLevel || selectedDay || selectedPeriod) && (
          <div className="px-4 py-2.5 bg-blue-50/50 border-t border-blue-100 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 mr-1">Aktif:</span>

            {searchQuery && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-700 pl-2.5 pr-1.5 py-1 rounded-full font-medium">
                "{searchQuery}"
                <button onClick={clearSearch} className="hover:bg-gray-200 p-0.5 rounded-full transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedLevel && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-blue-100 text-blue-700 pl-2.5 pr-1.5 py-1 rounded-full font-medium">
                <Building className="w-3 h-3" /> {selectedLevel}
                <button onClick={() => setSelectedLevel('')} className="hover:bg-blue-200 p-0.5 rounded-full transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedDay && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-emerald-100 text-emerald-700 pl-2.5 pr-1.5 py-1 rounded-full font-medium">
                <Calendar className="w-3 h-3" /> {selectedDay}
                <button onClick={() => setSelectedDay('')} className="hover:bg-emerald-200 p-0.5 rounded-full transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedPeriod && (
              <span className="inline-flex items-center gap-1.5 text-xs bg-orange-100 text-orange-700 pl-2.5 pr-1.5 py-1 rounded-full font-medium">
                <Clock className="w-3 h-3" /> {selectedPeriod}. Ders
                <button onClick={() => setSelectedPeriod('')} className="hover:bg-orange-200 p-0.5 rounded-full transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            <button
              onClick={() => { setSelectedLevel(''); setSelectedDay(''); setSelectedPeriod(''); setSearchQuery(''); }}
              className="ml-auto text-xs text-red-600 hover:text-red-700 font-medium flex items-center gap-1 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors"
            >
              <X className="w-3 h-3" /> Tümünü Temizle
            </button>
          </div>
        )}
      </div>

      {/* Conflicts Warning */}
      {conflicts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <FileText className="w-5 h-5 text-red-600 mt-0.5" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-semibold text-red-800">Program Çakışmaları Tespit Edildi</h3>
              <div className="mt-2 text-sm text-red-700">
                <ul className="list-disc list-inside space-y-1">
                  {conflicts.map((conflict, index) => (
                    <li key={index}>{conflict}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Statistics */}
      <div className="responsive-grid mb-6">
        <div className="mobile-card mobile-spacing">
          <div className="flex items-center">
            <Users className="w-8 h-8 text-blue-600 mr-3" />
            <div>
              <p className="text-sm text-gray-600">Toplam Öğretmen</p>
              <p className="text-2xl font-semibold text-gray-900">{teachers.length}</p>
            </div>
          </div>
        </div>
        <div className="mobile-card mobile-spacing">
          <div className="flex items-center">
            <Building className="w-8 h-8 text-emerald-600 mr-3" />
            <div>
              <p className="text-sm text-gray-600">Toplam Sınıf</p>
              <p className="text-2xl font-semibold text-gray-900">{classes.length}</p>
            </div>
          </div>
        </div>
        <div className="mobile-card mobile-spacing">
          <div className="flex items-center">
            <BookOpen className="w-8 h-8 text-ide-primary-600 mr-3" />
            <div>
              <p className="text-sm text-gray-600">Toplam Ders</p>
              <p className="text-2xl font-semibold text-gray-900">{subjects.length}</p>
            </div>
          </div>
        </div>
        <div className="mobile-card mobile-spacing">
          <div className="flex items-center">
            <Calendar className="w-8 h-8 text-ide-primary-600 mr-3" />
            <div>
              <p className="text-sm text-gray-600">Hazır Program</p>
              <p className="text-2xl font-semibold text-gray-900">{schedules.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Teacher Schedules */}
      <div className="space-y-6">
        {filteredTeachers.map(teacher => {
          const schedule = getTeacherSchedule(teacher.id);
          const isSelected = selectedTeacherId === teacher.id;

          return (
            <div key={teacher.id}
              id={`teacher-card-${teacher.id}`}
              className={`mobile-card mobile-spacing hover:shadow-md transition-shadow scroll-mt-20 ${isSelected ? 'ring-2 ring-emerald-500 shadow-lg' : ''}`}>
              <div className="p-4 bg-gray-50 border-b">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${schedule ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-gray-900 uppercase tracking-wide">{teacher.name}</span>
                      <span className="text-xs text-gray-500">{teacher.branch}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {schedule && (() => {
                      let regularHours = 0;
                      let clubHours = 0;
                      Object.values(schedule.schedule).forEach(day => {
                        Object.values(day || {}).forEach(slot => {
                          if (slot && slot.classId !== 'fixed-period') {
                            if (slot.subjectId === 'auto-subject-kulup') clubHours++;
                            else regularHours++;
                          }
                        });
                      });
                      const hasClub = clubHours > 0 || teacher.isClubTeacher;
                      return (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-100 shadow-sm">
                          <Clock className="w-3 h-3 mr-1" />
                          {regularHours} S. {hasClub ? `+ ${clubHours || 2} K.` : ''}
                        </span>
                      );
                    })()}
                    {schedule && (
                      <>
                        <Button
                          onClick={() => handleToggleTeacher(teacher.id)}
                          variant={isSelected ? "primary" : "secondary"}
                          size="sm"
                          className="font-bold whitespace-nowrap"
                        >
                          {isSelected ? 'Gizle' : 'Görüntüle'}
                        </Button>
                        <Button
                          onClick={() => downloadSingleTeacherPDF(teacher)}
                          icon={Download}
                          variant="primary"
                          size="sm"
                          className="font-bold bg-ide-primary-500 hover:bg-ide-primary-600 text-white shadow-md"
                        >
                          PDF
                        </Button>
                        <Button
                          onClick={() => navigate(`/schedules?teacherId=${teacher.id}`)}
                          icon={Edit}
                          variant="primary"
                          size="sm"
                          className="font-bold bg-ide-accent-500 hover:bg-ide-accent-600 text-white shadow-md"
                        >
                          Düzenle
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {isSelected && schedule && (
                <div className="border-t border-gray-200">
                  <div className="p-4 bg-emerald-50 border-b border-emerald-100 font-medium text-emerald-900">
                    📚 {teacher.name} Öğretmen Programı - {teacher.branch}
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
                            (!selectedDay || day === selectedDay) && (
                              <th key={day} className="px-3 py-2 text-center text-[10px] font-semibold text-gray-700 uppercase border bg-gray-50 tracking-wider">
                                {day}
                              </th>
                            )
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {(!selectedPeriod) && (
                          <tr className="bg-yellow-400">
                            <td className="px-3 py-2 font-semibold text-gray-900 border text-xs text-center border-black tracking-wide">
                              {teacher.level === 'Ortaokul' ? 'HAZIRLIK' : 'KAHVALTI'}
                            </td>
                            <td className="px-3 py-2 font-medium text-gray-900 border text-xs text-center border-black whitespace-nowrap">
                              {teacher.level === 'Ortaokul' ? '08:30-08:40' : '08:30-08:50'}
                            </td>
                            <td colSpan={selectedDay ? 1 : 5} className="px-3 py-2 font-semibold text-gray-900 border text-sm text-center border-black tracking-wide">
                              {teacher.level === 'Ortaokul' ? 'HAZIRLIK' : 'KAHVALTI / breakfast (20\')'}
                            </td>
                          </tr>
                        )}

                        {PERIODS.map(period => {
                          if (selectedPeriod && period !== selectedPeriod) return null;

                          const isLunchPeriod = (
                            (teacher.level === 'İlkokul' || teacher.level === 'Anaokulu') && period === '5'
                          ) || (
                              teacher.level === 'Ortaokul' && period === '6'
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
                                    ? (teacher.level === 'İlkokul' || teacher.level === 'Anaokulu' ? '11:50-12:25' : '12:30-13:05')
                                    : getTimeInfo(period, teacher.level)
                                  }
                                </td>

                                {isLunchPeriod ? (
                                  <td colSpan={selectedDay ? 1 : 5} className="px-3 py-2 font-semibold text-gray-900 border-black border text-sm text-center tracking-wide">
                                    ÖĞLE YEMEĞİ/LUNCH
                                  </td>
                                ) : (
                                  DAYS.map(day => {
                                    if (selectedDay && day !== selectedDay) return null;
                                    const slotInfo = getSlotInfo(teacher.id, day, period);
                                    return (
                                      <td key={`${day}-${period}`} className="px-2 py-2 border-black border">
                                        {slotInfo ? (
                                          <div className="text-center p-2 rounded">
                                            <div className="font-semibold text-gray-900 text-sm">
                                              {slotInfo.classItem?.name}
                                              {slotInfo.subjectItem && slotInfo.subjectItem.name !== 'KULÜP' && (
                                                <span className="text-xs font-normal text-gray-500 ml-1">
                                                  ({slotInfo.subjectItem.name})
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="text-center p-2">
                                            <div className="text-gray-400 text-xs">-</div>
                                          </div>
                                        )}
                                      </td>
                                    );
                                  })
                                )}
                              </tr>

                              {teacher.level === 'Ortaokul' && period === '1' && !selectedPeriod && (
                                <tr className="bg-yellow-400">
                                  <td className="px-3 py-2 font-semibold text-gray-900 border border-black text-xs text-center tracking-wide">KAHVALTI</td>
                                  <td className="px-3 py-2 font-medium text-gray-900 border border-black text-xs text-center">09:15-09:35</td>
                                  <td colSpan={selectedDay ? 1 : 5} className="px-3 py-2 font-semibold text-gray-900 border border-black text-sm text-center tracking-wide">KAHVALTI / breakfast (20')</td>
                                </tr>
                              )}

                              {showAfternoonBreakAfter && !selectedPeriod && (
                                <tr className="bg-yellow-400">
                                  <td className="px-3 py-2 font-semibold text-gray-900 border border-black text-xs text-center tracking-wide">İKİNDİ</td>
                                  <td className="px-3 py-2 font-medium text-gray-900 border border-black text-xs text-center">14:35-14:45</td>
                                  <td colSpan={selectedDay ? 1 : 5} className="px-3 py-2 font-semibold text-gray-900 border border-black text-sm text-center tracking-wide">İKİNDİ KAHVALTISI / snack (10')</td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!isSelected && schedule && (
                <div style={{
                  position: 'absolute',
                  left: '-9999px',
                  top: '-9999px',
                  zIndex: -1,
                  opacity: 0,
                  pointerEvents: 'none'
                }}>
                  <div
                    ref={el => printRefs.current[teacher.id] = el}
                    data-teacher-id={teacher.id}
                    style={{
                      transform: 'none',
                      position: 'static'
                    }}
                  >
                    <SchedulePrintView
                      teacher={teacher}
                      schedule={schedule}
                      classes={classes}
                      subjects={subjects}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filteredTeachers.length === 0 && (
          <div className="text-center py-12 mobile-card">
            <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchQuery ? 'Arama Sonucu Bulunamadı' : 'Öğretmen Bulunamadı'}
            </h3>
            <p className="text-gray-500 mb-4">
              {searchQuery
                ? `"${searchQuery}" araması için sonuç bulunamadı`
                : 'Seçilen filtrelere uygun öğretmen bulunmuyor'
              }
            </p>
            {(searchQuery || selectedLevel) && (
              <div className="button-group-mobile flex justify-center">
                {searchQuery && (
                  <Button onClick={clearSearch} variant="secondary">
                    Aramayı Temizle
                  </Button>
                )}
                {selectedLevel && (
                  <Button onClick={() => setSelectedLevel('')} variant="secondary">
                    Filtreleri Temizle
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmationModal {...confirmation} onClose={hideConfirmation} />
    </div>
  );
};

export default AllSchedules;
