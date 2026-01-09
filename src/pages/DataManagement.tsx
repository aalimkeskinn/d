import React, { useState, useRef } from 'react';
import {
  Users,
  Building,
  BookOpen,
  MapPin,
  Calendar,
  Settings,
  Download,
  Trash2,
  AlertTriangle,
  Upload,
  Database,
  BarChart3,
  HeartPulse,
  CheckCircle,
  GitCompare,
  Clock,
  Filter,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFirestore } from '../hooks/useFirestore';
import { useToast } from '../hooks/useToast';
import { useConfirmation } from '../hooks/useConfirmation';
import { Teacher, Class, Subject, Schedule } from '../types';
import { parseComprehensiveCSV } from '../utils/csvParser';
import { validateDistributions, summarizeResults, DistributionMismatch } from '../utils/distributionValidator';
import Button from '../components/UI/Button';
import ConfirmationModal from '../components/UI/ConfirmationModal';
import Modal from '../components/UI/Modal';
import { doc, writeBatch, getDocs, query, collection, deleteDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { TimeConstraint, CONSTRAINT_TYPES } from '../types/constraints';
import { WizardData } from '../types/wizard';

// Interfaces
interface ScheduleTemplate { id: string; name: string; wizardData?: WizardData; }
interface Classroom { id: string; name: string; }
interface ParsedDataState {
  teachers: Teacher[];
  classes: Class[];
  subjects: Subject[];
  errors: string[];
}

const downloadCSV = (content: string, fileName: string) => {
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const DataManagement = () => {
  const navigate = useNavigate();
  const { data: teachers } = useFirestore<Teacher>('teachers');
  const { data: classes } = useFirestore<Class>('classes');
  const { data: subjects } = useFirestore<Subject>('subjects');
  const { data: schedules } = useFirestore<Schedule>('schedules');
  const { data: templates } = useFirestore<ScheduleTemplate>('schedule-templates');
  const { data: classrooms } = useFirestore<Classroom>('classrooms');
  const { success, error, warning, info } = useToast();
  const { confirmation, hideConfirmation, confirmDelete } = useConfirmation();

  // Tüm şablonlardan kısıtlamaları topla
  const allConstraints: (TimeConstraint & { templateName: string })[] = templates.flatMap(template =>
    (template.wizardData?.constraints?.timeConstraints || []).map(c => ({
      ...c,
      templateName: template.name
    }))
  );

  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const comprehensiveFileInputRef = useRef<HTMLInputElement>(null);
  const [isComprehensiveCSVModalOpen, setIsComprehensiveCSVModalOpen] = useState(false);
  const [parsedData, setParsedData] = useState<ParsedDataState | null>(null);
  const [parsingErrors, setParsingErrors] = useState<string[]>([]);
  const [isImportingAll, setIsImportingAll] = useState(false);
  const [exploringCollection, setExploringCollection] = useState<{ id: string, title: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDangerModeEnabled, setIsDangerModeEnabled] = useState(false);

  // Veri sağlığı kontrolü için state
  const [healthCheckResults, setHealthCheckResults] = useState<{ overbookedTeachers: { name: string; totalHours: number }[] }>({ overbookedTeachers: [] });
  const [isHealthCheckModalOpen, setIsHealthCheckModalOpen] = useState(false);

  // Dağıtım şekli doğrulama için state
  const [distributionCheckResults, setDistributionCheckResults] = useState<DistributionMismatch[]>([]);
  const [isDistributionModalOpen, setIsDistributionModalOpen] = useState(false);
  const [distributionFilter, setDistributionFilter] = useState<'all' | 'mismatch' | 'match'>('all');
  const [levelFilter, setLevelFilter] = useState<'all' | 'Anaokulu' | 'İlkokul' | 'Ortaokul'>('all');

  // Kısıtlamalar görüntüleme için state
  const [isConstraintsModalOpen, setIsConstraintsModalOpen] = useState(false);
  const [constraintEntityFilter, setConstraintEntityFilter] = useState<'all' | 'teacher' | 'class' | 'subject'>('all');
  const [constraintTypeFilter, setConstraintTypeFilter] = useState<'all' | 'unavailable' | 'preferred' | 'restricted'>('all');

  // Veri Sağlığı Kontrolü Fonksiyonu
  const runDataHealthCheck = () => {
    const teacherHours = new Map<string, number>();

    classes.forEach(c => {
      c.assignments?.forEach(assignment => {
        const teacherId = assignment.teacherId;
        assignment.subjectIds.forEach(subjectId => {
          const subject = subjects.find(s => s.id === subjectId);
          if (subject) {
            const currentHours = teacherHours.get(teacherId) || 0;
            teacherHours.set(teacherId, currentHours + subject.weeklyHours);
          }
        });
      });
    });

    const overbookedTeachers: { name: string; totalHours: number }[] = [];
    teacherHours.forEach((totalHours, teacherId) => {
      if (totalHours > 45) {
        const teacher = teachers.find(t => t.id === teacherId);
        if (teacher) {
          overbookedTeachers.push({ name: teacher.name, totalHours });
        }
      }
    });

    setHealthCheckResults({ overbookedTeachers });
    setIsHealthCheckModalOpen(true);
  };

  // Dağıtım Şekli Doğrulama Fonksiyonu
  const runDistributionCheck = () => {
    if (schedules.length === 0) {
      warning('⚠️ Program Bulunamadı', 'Henüz oluşturulmuş bir program yok. Önce bir program oluşturun.');
      return;
    }
    if (subjects.length === 0) {
      warning('⚠️ Ders Bulunamadı', 'Sistemde kayıtlı ders yok.');
      return;
    }

    const results = validateDistributions(subjects, schedules, teachers, classes);
    setDistributionCheckResults(results);
    setDistributionFilter('all');
    setIsDistributionModalOpen(true);
  };

  const handleComprehensiveCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) { error('❌ Dosya Hatası', 'Dosya içeriği okunamadı'); return; }
      try {
        const result = parseComprehensiveCSV(content);
        setParsedData(result);
        setParsingErrors(result.errors);
        setIsComprehensiveCSVModalOpen(true);
      } catch (err) {
        console.error('CSV processing error:', err);
        error('❌ CSV Hatası', 'Dosya işlenirken hata oluştu.');
      } finally {
        if (comprehensiveFileInputRef.current) comprehensiveFileInputRef.current.value = '';
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleDownloadCSVTemplate = () => {
    const templateContent = `öğretmen adı; branş;eğitim seviyesi;ders Adı;sınıf ve şube;haftalık saat\n"Öğretmen 1"; "SINIF ÖĞRETMENLİĞİ"; "İLKOKUL"; "TÜRKÇE"; "1A"; "10"\n"Öğretmen 1"; "SINIF ÖĞRETMENLİĞİ"; "İLKOKUL"; "MATEMATİK"; "1A"; "5"`;
    downloadCSV(templateContent, 'kapsamli_veri_sablonu.csv');
    success('✅ Şablon İndirildi', 'CSV şablonu başarıyla indirildi');
  };

  const cleanObjectForFirestore = (obj: any) => {
    const clean: any = {};
    Object.keys(obj).forEach(key => {
      if (obj[key] !== undefined) {
        clean[key] = obj[key];
      } else {
        clean[key] = null;
      }
    });
    return clean;
  };

  const handleImportAllData = async () => {
    if (!parsedData) return;
    setIsImportingAll(true);
    info('Veri aktarımı başladı...', 'Lütfen bekleyin.');

    try {
      const { teachers: newTeachers, classes: newClasses, subjects: newSubjects } = parsedData;

      // 1. Subjects Import
      let subjectsBatch = writeBatch(db);
      let subjectsCount = 0;
      for (const subject of newSubjects) {
        const docRef = doc(db, "subjects", subject.id);
        subjectsBatch.set(docRef, cleanObjectForFirestore({ ...subject, createdAt: new Date() }), { merge: true });
        subjectsCount++;
        if (subjectsCount === 450) {
          await subjectsBatch.commit();
          subjectsBatch = writeBatch(db);
          subjectsCount = 0;
        }
      }
      if (subjectsCount > 0) await subjectsBatch.commit();

      // 2. Teachers Import
      let teachersBatch = writeBatch(db);
      let teachersCount = 0;
      for (const teacher of newTeachers) {
        const teacherSubjectIds = new Set<string>();
        newClasses.forEach(cls => {
          cls.assignments?.forEach(assignment => {
            if (assignment.teacherId === teacher.id) {
              assignment.subjectIds.forEach(sid => teacherSubjectIds.add(sid));
            }
          });
        });

        const docRef = doc(db, "teachers", teacher.id);
        teachersBatch.set(docRef, cleanObjectForFirestore({
          ...teacher,
          subjectIds: Array.from(teacherSubjectIds),
          createdAt: new Date()
        }), { merge: true });

        teachersCount++;
        if (teachersCount === 450) {
          await teachersBatch.commit();
          teachersBatch = writeBatch(db);
          teachersCount = 0;
        }
      }
      if (teachersCount > 0) await teachersBatch.commit();

      // 3. Classes Import
      let classesBatch = writeBatch(db);
      let classesCount = 0;
      for (const cls of newClasses) {
        const docRef = doc(db, "classes", cls.id);
        classesBatch.set(docRef, cleanObjectForFirestore({ ...cls, createdAt: new Date() }), { merge: true });

        classesCount++;
        if (classesCount === 450) {
          await classesBatch.commit();
          classesBatch = writeBatch(db);
          classesCount = 0;
        }
      }
      if (classesCount > 0) await classesBatch.commit();

      success('✅ Aktarım Tamamlandı!', `${newSubjects.length} ders, ${newTeachers.length} öğretmen ve ${newClasses.length} sınıf aktarıldı.`);
    } catch (err: any) {
      console.error('Import error:', err);
      error('❌ Aktarım Hatası', `Hata: ${err.message}`);
    } finally {
      setIsImportingAll(false);
      setIsComprehensiveCSVModalOpen(false);
    }
  };

  const handleDeleteAllData = () => {
    const allData = [
      { name: 'teachers', data: teachers },
      { name: 'classes', data: classes },
      { name: 'subjects', data: subjects },
      { name: 'schedules', data: schedules },
      { name: 'schedule-templates', data: templates },
      { name: 'classrooms', data: classrooms },
    ];
    const totalItemCount = allData.reduce((sum, item) => sum + item.data.length, 0);
    if (totalItemCount === 0) {
      warning('⚠️ Silinecek Veri Yok', 'Silinecek veri bulunamadı.');
      return;
    }
    confirmDelete(`Tüm Veriler (${totalItemCount} öğe)`, async () => {
      setIsDeletingAll(true);
      info('Temizlik başladı...', 'Ekranda görünen veriler siliniyor.');
      try {
        let batch = writeBatch(db);
        let count = 0;
        for (const collData of allData) {
          for (const item of collData.data) {
            batch.delete(doc(db, collData.name, item.id));
            count++;
            if (count === 450) { await batch.commit(); batch = writeBatch(db); count = 0; }
          }
        }
        if (count > 0) await batch.commit();
        success('🗑️ Temizlik Tamamlandı', `${totalItemCount} veri öğesi silindi.`);
      } catch (err: any) {
        error('❌ Hata', err.message);
      } finally { setIsDeletingAll(false); }
    });
  };

  const handleForceWipe = async () => {
    const collectionsToClear = ['teachers', 'classes', 'subjects', 'schedules', 'schedule-templates', 'classrooms', 'constraints', 'timeConstraints'];
    confirmDelete('TÜM VERİTABANI (Sert Sıfırlama)', async () => {
      setIsDeletingAll(true);
      info('Derin temizlik başladı...', 'Doğrudan veritabanı taranıyor.');
      try {
        let totalDeleted = 0;
        for (const collName of collectionsToClear) {
          const snapshot = await getDocs(query(collection(db, collName)));
          let batch = writeBatch(db);
          let count = 0;
          for (const docSnap of snapshot.docs) {
            batch.delete(docSnap.ref);
            count++;
            totalDeleted++;
            if (count === 450) { await batch.commit(); batch = writeBatch(db); count = 0; }
          }
          if (count > 0) await batch.commit();
        }
        success('🛡️ Derin Temizlik Tamamlandı', `${totalDeleted} kayıt silindi.`);
      } catch (err: any) {
        error('❌ Hata', err.message);
      } finally { setIsDeletingAll(false); }
    });
  };

  const handleDeleteItem = async (collectionName: string, id: string, name: string) => {
    confirmDelete(`${name} (${id})`, async () => {
      try {
        await deleteDoc(doc(db, collectionName, id));
        success('✅ Silindi', `${name} kaldırıldı.`);
      } catch (err: any) {
        error('❌ Hata', err.message);
      }
    });
  };

  const getExploringData = () => {
    if (!exploringCollection) return [];
    let items: any[] = [];
    switch (exploringCollection.id) {
      case 'teachers': items = teachers; break;
      case 'classes': items = classes; break;
      case 'subjects': items = subjects; break;
      case 'classrooms': items = classrooms; break;
      case 'schedules': items = schedules; break;
      case 'schedule-templates': items = templates; break;
    }
    if (searchTerm) {
      const lowerSearch = searchTerm.toLocaleLowerCase('tr-TR');
      return items.filter(item =>
        (item.name?.toLocaleLowerCase('tr-TR').includes(lowerSearch)) ||
        (item.id?.toLocaleLowerCase('tr-TR').includes(lowerSearch))
      );
    }
    return items;
  };

  const totalDataCount = teachers.length + classes.length + subjects.length + schedules.length + templates.length + classrooms.length;
  const dataCards = [
    { title: 'Öğretmenler', count: teachers.length, icon: Users, color: 'blue', path: '/teachers' },
    { title: 'Sınıflar', count: classes.length, icon: Building, color: 'emerald', path: '/classes' },
    { title: 'Dersler', count: subjects.length, icon: BookOpen, color: 'indigo', path: '/subjects' },
    { title: 'Derslikler', count: classrooms.length, icon: MapPin, color: 'teal', path: '/classrooms' },
    { title: 'Programlar', count: schedules.length, icon: Calendar, color: 'purple', path: '/all-schedules' },
    { title: 'Şablonlar', count: templates.length, icon: Settings, color: 'orange', path: '/' }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center">
            <Database className="w-8 h-8 text-ide-primary-600 mr-3" />
            <div>
              <h1 className="text-xl font-bold text-gray-900">Veri Yönetimi</h1>
              <p className="text-sm text-gray-600">Sistem verilerini yönetin ve temizleyin</p>
            </div>
          </div>
          <Button onClick={() => navigate('/')} variant="secondary">Ana Sayfaya Dön</Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center mb-4"><Upload className="w-6 h-6 text-blue-500 mr-3" /><h2 className="text-lg font-bold text-gray-900">Akıllı Veri Yükleme</h2></div>
            <p className="text-sm text-gray-600 mb-4">Verilen CSV şablonunu tek seferde yükleyerek tüm verileri sisteme otomatik olarak ekleyin.</p>
            <div className="flex items-center space-x-3">
              <input type="file" accept=".csv" onChange={handleComprehensiveCSVUpload} ref={comprehensiveFileInputRef} className="hidden" />
              <Button onClick={() => comprehensiveFileInputRef.current?.click()} icon={Upload} variant="primary">CSV Yükle</Button>
              <Button onClick={handleDownloadCSVTemplate} icon={Download} variant="secondary">Şablon İndir</Button>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center mb-4"><HeartPulse className="w-6 h-6 text-green-500 mr-3" /><h2 className="text-lg font-bold text-gray-900">Veri Sağlığı</h2></div>
            <p className="text-sm text-gray-600 mb-4">Öğretmenlerin ders yükleri gibi olası mantık hatalarını kontrol edin.</p>
            <Button onClick={runDataHealthCheck} icon={HeartPulse} variant="secondary" className="bg-green-50 text-green-700">Kontrolü Başlat</Button>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center mb-4"><GitCompare className="w-6 h-6 text-blue-500 mr-3" /><h2 className="text-lg font-bold text-gray-900">Dağıtım Şekli Doğrulama</h2></div>
            <p className="text-sm text-gray-600 mb-4">CSV'den yüklenen dağıtım şekillerini oluşturulan programlarla karşılaştırın.</p>
            <Button onClick={runDistributionCheck} icon={GitCompare} variant="secondary" className="bg-blue-50 text-blue-700">Doğrulamayı Başlat</Button>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center mb-4"><Clock className="w-6 h-6 text-purple-500 mr-3" /><h2 className="text-lg font-bold text-gray-900">Kısıtlamalar</h2></div>
            <p className="text-sm text-gray-600 mb-4">Sistemde kayıtlı tüm öğretmen, sınıf ve ders kısıtlamalarını görüntüleyin.</p>
            <div className="flex items-center gap-2">
              <Button onClick={() => setIsConstraintsModalOpen(true)} icon={Clock} variant="secondary" className="bg-purple-50 text-purple-700">Kısıtlamaları Görüntüle</Button>
              <span className="text-sm text-gray-500 font-medium">{allConstraints.length} kısıtlama</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center"><BarChart3 className="w-6 h-6 text-ide-primary-600 mr-2" /><h2 className="text-lg font-semibold text-gray-900">Veri İstatistikleri</h2></div>
            <div className="text-sm text-gray-600">Toplam {totalDataCount} öğe</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {dataCards.map(card => (
              <div key={card.title} className="bg-gray-50 rounded-xl p-4 border border-gray-100 flex flex-col items-center justify-between min-h-[180px] shadow-sm">
                <div className="flex flex-col items-center text-center">
                  <card.icon className="w-8 h-8 text-gray-600 mb-2" />
                  <h3 className="font-semibold text-gray-900 text-sm">{card.title}</h3>
                </div>
                <span className="text-3xl font-semibold text-gray-800 my-2">{card.count}</span>
                <div className="flex flex-col gap-2 w-full mt-auto">
                  <Button onClick={() => navigate(card.path)} variant="secondary" size="sm" className="w-full text-xs whitespace-nowrap">Yönet</Button>
                  <Button onClick={() => setExploringCollection({ id: card.path.replace('/', '').replace('all-schedules', 'schedules'), title: card.title })} variant="primary" size="sm" className="w-full text-xs whitespace-nowrap">Gözat</Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {exploringCollection && (
          <div className="bg-white rounded-lg shadow-sm border border-ide-primary-200 p-6 mb-8 overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
              <div className="flex items-center">
                <BarChart3 className="w-6 h-6 text-ide-primary-600 mr-2" />
                <h2 className="text-lg font-semibold text-gray-900">{exploringCollection.title} Gezgini</h2>
                <span className="ml-3 bg-ide-primary-100 text-ide-primary-700 text-xs font-semibold px-2 py-1 rounded-full">{getExploringData().length} öğe</span>
              </div>
              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <input
                  type="text"
                  placeholder="Ara..."
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-full"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <Button onClick={() => setExploringCollection(null)} variant="secondary" size="sm">Kapat</Button>
              </div>
            </div>
            <div className="max-h-[500px] overflow-y-auto border border-gray-200 rounded-lg text-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider">İsim / Başlık</th>
                    <th className="px-6 py-3 text-left font-semibold text-gray-500 uppercase tracking-wider">ID</th>
                    <th className="px-6 py-3 text-right font-semibold text-gray-500 tracking-wider">İşlem</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {getExploringData().map((item: any) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 truncate max-w-[200px]">{item.name || item.title || 'İsimsiz Öğe'}</td>
                      <td className="px-6 py-4"><code className="text-xs bg-gray-100 px-1 rounded">{item.id}</code></td>
                      <td className="px-6 py-4 text-right">
                        <Button onClick={() => handleDeleteItem(exploringCollection.id, item.id, item.name || item.title || 'İsimsiz')} variant="danger" size="sm" icon={Trash2}>Sil</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-red-50 rounded-lg shadow-sm border border-red-200 p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
            <div className="flex items-center">
              <AlertTriangle className="w-6 h-6 text-red-600 mr-2" />
              <h2 className="text-lg font-semibold text-red-900 uppercase tracking-wider">Tehlikeli Bölge</h2>
            </div>

            {/* Danger Mode Toggle */}
            <label className="flex items-center space-x-3 bg-red-100 px-4 py-2 rounded-xl border border-red-200 cursor-pointer hover:bg-red-200 transition-colors group">
              <span className="text-sm font-semibold text-red-800 select-none uppercase tracking-wider">
                Tehlikeli İşlemleri Kilidini Aç
              </span>
              <div className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={isDangerModeEnabled}
                  onChange={(e) => setIsDangerModeEnabled(e.target.checked)}
                />
                <div className="w-11 h-6 bg-red-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
              </div>
            </label>
          </div>

          {!isDangerModeEnabled ? (
            <div className="bg-white rounded-lg border border-red-100 p-8 text-center">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-red-900 mb-2 uppercase tracking-tight">Veri Silme İşlemleri Kilitli</h3>
              <p className="text-sm text-red-700 max-w-md mx-auto">
                Kazara veri kaybını önlemek için silme butonları gizlenmiştir. İşlem yapmak için yukarıdaki anahtarı kullanın.
              </p>
            </div>
          ) : (
            <div className="space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="p-5 bg-white rounded-lg border border-red-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                <div>
                  <h3 className="font-semibold text-red-900">Tüm Verileri Sil (Hızlı)</h3>
                  <p className="text-sm text-red-700 mt-1">Sadece sistemde yüklü olan (ekranda görünen) verileri siler.</p>
                </div>
                <Button onClick={handleDeleteAllData} icon={Trash2} variant="danger" disabled={isDeletingAll || totalDataCount === 0} className="w-full sm:w-auto shadow-md">
                  {isDeletingAll ? 'Siliniyor...' : `Tümünü Sil (${totalDataCount})`}
                </Button>
              </div>

              <div className="p-5 bg-red-100 rounded-lg border border-red-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
                <div>
                  <h3 className="font-semibold text-red-900">Derin Temizlik (Kritik İşlem)</h3>
                  <p className="text-sm text-red-800 mt-1">Veritabanındaki TÜM koleksiyonları tarar ve gizli/kopya kayıtları temizler. 712 ders hatası gibi durumlarda kullanın.</p>
                </div>
                <Button onClick={handleForceWipe} icon={Database} variant="danger" disabled={isDeletingAll} className="!bg-red-700 w-full sm:w-auto shadow-lg hover:!bg-red-800">
                  {isDeletingAll ? 'Süpürülüyor...' : 'Derin Temizlik Başlat'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={isComprehensiveCSVModalOpen} onClose={() => setIsComprehensiveCSVModalOpen(false)} title="İçe Aktarma Önizlemesi" size="xl">
        <div className="space-y-6">
          <div className="p-4 bg-green-50 rounded-lg border border-green-200 grid grid-cols-3 gap-4 text-center">
            <div><p className="text-2xl font-semibold text-green-700">{parsedData?.teachers.length || 0}</p><p className="text-xs text-green-600 lowercase tracking-wider">öğretmen</p></div>
            <div><p className="text-2xl font-semibold text-green-700">{parsedData?.classes.length || 0}</p><p className="text-xs text-green-600 lowercase tracking-wider">sınıf</p></div>
            <div><p className="text-2xl font-semibold text-green-700">{parsedData?.subjects.length || 0}</p><p className="text-xs text-green-600 lowercase tracking-wider">ders</p></div>
          </div>
          {parsingErrors.length > 0 && (
            <div className="p-4 bg-red-50 rounded-lg border border-red-200 max-h-40 overflow-y-auto">
              <h4 className="text-sm font-medium text-red-800 mb-2">Hatalar:</h4>
              <ul className="list-disc list-inside text-xs text-red-700">{parsingErrors.map((err, i) => <li key={i}>{err}</li>)}</ul>
            </div>
          )}
          <div className="flex justify-end space-x-3"><Button onClick={() => setIsComprehensiveCSVModalOpen(false)} variant="secondary">İptal</Button><Button onClick={handleImportAllData} variant="primary" disabled={isImportingAll}>{isImportingAll ? 'Aktarılıyor...' : 'Onayla ve İçe Aktar'}</Button></div>
        </div>
      </Modal>

      <Modal isOpen={isHealthCheckModalOpen} onClose={() => setIsHealthCheckModalOpen(false)} title="Veri Sağlığı Kontrolü">
        {healthCheckResults.overbookedTeachers.length === 0 ? (
          <div className="text-center p-6"><CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" /><h3 className="text-lg font-medium text-gray-900">Her Şey Yolunda!</h3></div>
        ) : (
          <div>
            <p className="text-sm text-red-700 mb-4 font-medium italic">Aşağıdaki öğretmenlerin haftalık ders yükleri 45 saati aşıyor:</p>
            <ul className="divide-y divide-gray-200 border rounded-lg overflow-hidden">
              {healthCheckResults.overbookedTeachers.map(teacher => (
                <li key={teacher.name} className="py-2 px-4 flex justify-between items-center text-sm"><span className="font-semibold">{teacher.name}</span><span className="text-red-600 font-semibold">{teacher.totalHours} saat</span></li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-6 flex justify-end"><Button onClick={() => setIsHealthCheckModalOpen(false)} variant="primary">Kapat</Button></div>
      </Modal>

      {/* Dağıtım Şekli Doğrulama Modal */}
      <Modal isOpen={isDistributionModalOpen} onClose={() => setIsDistributionModalOpen(false)} title="Dağıtım Şekli Doğrulama Sonuçları" size="4xl">
        {(() => {
          const summary = summarizeResults(distributionCheckResults);
          const filteredResults = distributionCheckResults.filter(r => {
            // Level filtresi
            if (levelFilter !== 'all' && r.level !== levelFilter) return false;
            // Status filtresi
            if (distributionFilter === 'mismatch') return r.status === 'mismatch';
            if (distributionFilter === 'match') return r.status === 'match';
            return true;
          });
          return (
            <div className="space-y-6">
              {/* Özet Kartları - Daha büyük ve gösterişli */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-5 border border-gray-200 text-center shadow-sm">
                  <p className="text-3xl font-bold text-gray-700">{summary.total}</p>
                  <p className="text-sm text-gray-500 mt-1">Toplam Ders</p>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-5 border border-green-200 text-center shadow-sm">
                  <p className="text-3xl font-bold text-green-600">{summary.matches}</p>
                  <p className="text-sm text-green-600 mt-1">✅ Eşleşen</p>
                </div>
                <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-5 border border-red-200 text-center shadow-sm">
                  <p className="text-3xl font-bold text-red-600">{summary.mismatches}</p>
                  <p className="text-sm text-red-600 mt-1">❌ Uyumsuz</p>
                </div>
                <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-5 border border-gray-200 text-center shadow-sm">
                  <p className="text-3xl font-bold text-gray-400">{summary.noSchedule + summary.noExpected}</p>
                  <p className="text-sm text-gray-400 mt-1">⚠️ Veri Yok</p>
                </div>
              </div>

              {/* Filtreler - Yan yana düzenli */}
              <div className="flex flex-wrap items-center gap-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
                {/* Durum Filtresi */}
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 font-semibold">Durum:</span>
                  <div className="flex gap-2">
                    <button onClick={() => setDistributionFilter('all')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${distributionFilter === 'all' ? 'bg-gray-800 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-100'}`}>Tümü</button>
                    <button onClick={() => setDistributionFilter('mismatch')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${distributionFilter === 'mismatch' ? 'bg-red-600 text-white shadow-md' : 'bg-white text-red-600 border border-red-200 hover:bg-red-50'}`}>Uyumsuz</button>
                    <button onClick={() => setDistributionFilter('match')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${distributionFilter === 'match' ? 'bg-green-600 text-white shadow-md' : 'bg-white text-green-600 border border-green-200 hover:bg-green-50'}`}>Eşleşen</button>
                  </div>
                </div>

                {/* Seviye Filtresi */}
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-700 font-semibold">Seviye:</span>
                  <div className="flex gap-2">
                    <button onClick={() => setLevelFilter('all')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${levelFilter === 'all' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-indigo-600 border border-indigo-200 hover:bg-indigo-50'}`}>Tümü</button>
                    <button onClick={() => setLevelFilter('Anaokulu')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${levelFilter === 'Anaokulu' ? 'bg-pink-600 text-white shadow-md' : 'bg-white text-pink-600 border border-pink-200 hover:bg-pink-50'}`}>Anaokulu</button>
                    <button onClick={() => setLevelFilter('İlkokul')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${levelFilter === 'İlkokul' ? 'bg-blue-600 text-white shadow-md' : 'bg-white text-blue-600 border border-blue-200 hover:bg-blue-50'}`}>İlkokul</button>
                    <button onClick={() => setLevelFilter('Ortaokul')} className={`px-4 py-2 text-sm rounded-lg font-medium transition-all ${levelFilter === 'Ortaokul' ? 'bg-orange-600 text-white shadow-md' : 'bg-white text-orange-600 border border-orange-200 hover:bg-orange-50'}`}>Ortaokul</button>
                  </div>
                </div>
              </div>

              {/* Sonuç Tablosu */}
              <div className="max-h-[500px] overflow-y-auto border border-gray-200 rounded-xl shadow-sm">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-100 sticky top-0">
                    <tr>
                      <th className="px-5 py-3 text-left text-sm font-bold text-gray-600 uppercase tracking-wider w-28">Durum</th>
                      <th className="px-5 py-3 text-left text-sm font-bold text-gray-600 uppercase tracking-wider w-40">Ders</th>
                      <th className="px-5 py-3 text-left text-sm font-bold text-gray-600 uppercase tracking-wider w-20">Sınıf</th>
                      <th className="px-5 py-3 text-left text-sm font-bold text-gray-600 uppercase tracking-wider w-36">Öğretmen</th>
                      <th className="px-5 py-3 text-left text-sm font-bold text-gray-600 uppercase tracking-wider">Dağıtım Detayı</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {filteredResults.map((r, idx) => (
                      <tr key={idx} className={`hover:bg-blue-50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                        <td className="px-5 py-3 whitespace-nowrap">
                          {r.status === 'match' && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">✅ Eşleşme</span>}
                          {r.status === 'mismatch' && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">❌ Uyumsuz</span>}
                          {r.status === 'no-expected' && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">⚠️ Beklenen Yok</span>}
                          {r.status === 'no-schedule' && <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">⚠️ Program Yok</span>}
                        </td>
                        <td className="px-5 py-3 font-semibold text-gray-800 text-sm" title={r.subjectName}>{r.subjectName}</td>
                        <td className="px-5 py-3 text-sm font-medium text-gray-600">{r.className}</td>
                        <td className="px-5 py-3 text-sm text-gray-600" title={r.teacherName}>{r.teacherName}</td>
                        <td className="px-5 py-3 text-sm">
                          {r.status === 'match' && (
                            <span className="text-green-700 flex items-center gap-2">
                              <code className="bg-green-100 text-green-800 px-2 py-1 rounded-md font-mono text-xs">{r.expectedPattern}</code>
                              <span className="text-green-600">olarak dağıtıldı ✓</span>
                            </span>
                          )}
                          {r.status === 'mismatch' && (
                            <span className="text-red-700 flex flex-wrap items-center gap-2">
                              <span className="text-red-600">Beklenen:</span>
                              <code className="bg-red-100 text-red-800 px-2 py-1 rounded-md font-mono text-xs">{r.expectedPattern}</code>
                              <span className="text-gray-500">→</span>
                              <span className="text-red-600">Gerçek:</span>
                              <code className="bg-red-100 text-red-800 px-2 py-1 rounded-md font-mono text-xs">{r.actualPattern}</code>
                            </span>
                          )}
                          {r.status === 'no-expected' && (
                            <span className="text-gray-500 flex items-center gap-2">
                              <span>CSV'de belirtilmemiş, programda:</span>
                              <code className="bg-gray-100 px-2 py-1 rounded-md font-mono text-xs">{r.actualPattern}</code>
                            </span>
                          )}
                          {r.status === 'no-schedule' && (
                            <span className="text-gray-500 flex items-center gap-2">
                              <span>Henüz program yok. Beklenen:</span>
                              <code className="bg-gray-100 px-2 py-1 rounded-md font-mono text-xs">{r.expectedPattern || '-'}</code>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredResults.length === 0 && (
                      <tr><td colSpan={5} className="px-5 py-12 text-center text-gray-500">Bu filtreye uygun sonuç bulunamadı.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end pt-2"><Button onClick={() => setIsDistributionModalOpen(false)} variant="primary">Kapat</Button></div>
            </div>
          );
        })()}
      </Modal>

      {/* Kısıtlamalar Modal */}
      <Modal
        isOpen={isConstraintsModalOpen}
        onClose={() => setIsConstraintsModalOpen(false)}
        title="Sistemde Kayıtlı Kısıtlamalar"
        size="4xl"
      >
        {(() => {
          // Entity isimlerini bul
          const getEntityName = (entityType: string, entityId: string) => {
            if (entityType === 'teacher') {
              const teacher = teachers.find(t => t.id === entityId);
              return teacher?.name || entityId;
            } else if (entityType === 'class') {
              const cls = classes.find(c => c.id === entityId);
              return cls?.name || entityId;
            } else if (entityType === 'subject') {
              const subject = subjects.find(s => s.id === entityId);
              return subject?.name || entityId;
            }
            return entityId;
          };

          // Filtreleme
          const filteredConstraints = allConstraints.filter(c => {
            if (constraintEntityFilter !== 'all' && c.entityType !== constraintEntityFilter) return false;
            if (constraintTypeFilter !== 'all' && c.constraintType !== constraintTypeFilter) return false;
            return true;
          });

          // İstatistikler
          const teacherCount = allConstraints.filter(c => c.entityType === 'teacher').length;
          const classCount = allConstraints.filter(c => c.entityType === 'class').length;
          const subjectCount = allConstraints.filter(c => c.entityType === 'subject').length;
          const unavailableCount = allConstraints.filter(c => c.constraintType === 'unavailable').length;
          const preferredCount = allConstraints.filter(c => c.constraintType === 'preferred').length;
          const restrictedCount = allConstraints.filter(c => c.constraintType === 'restricted').length;

          return (
            <div className="space-y-6">
              {/* Özet İstatistikler */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 text-center border border-purple-200">
                  <div className="text-2xl font-bold text-purple-700">{allConstraints.length}</div>
                  <div className="text-xs font-medium text-purple-600">Toplam</div>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 text-center border border-blue-200">
                  <div className="text-2xl font-bold text-blue-700">{teacherCount}</div>
                  <div className="text-xs font-medium text-blue-600">Öğretmen</div>
                </div>
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 rounded-xl p-4 text-center border border-emerald-200">
                  <div className="text-2xl font-bold text-emerald-700">{classCount}</div>
                  <div className="text-xs font-medium text-emerald-600">Sınıf</div>
                </div>
                <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-xl p-4 text-center border border-indigo-200">
                  <div className="text-2xl font-bold text-indigo-700">{subjectCount}</div>
                  <div className="text-xs font-medium text-indigo-600">Ders</div>
                </div>
                <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-xl p-4 text-center border border-red-200">
                  <div className="text-2xl font-bold text-red-700">{unavailableCount}</div>
                  <div className="text-xs font-medium text-red-600">Müsait Değil</div>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 text-center border border-green-200">
                  <div className="text-2xl font-bold text-green-700">{preferredCount}</div>
                  <div className="text-xs font-medium text-green-600">Tercih</div>
                </div>
                <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-xl p-4 text-center border border-yellow-200">
                  <div className="text-2xl font-bold text-yellow-700">{restrictedCount}</div>
                  <div className="text-xs font-medium text-yellow-600">Kısıtlı</div>
                </div>
              </div>

              {/* Filtreler */}
              <div className="flex flex-wrap items-center gap-4 bg-gray-50 rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">Varlık Tipi:</span>
                  <div className="flex gap-1">
                    {(['all', 'teacher', 'class', 'subject'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setConstraintEntityFilter(type)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${constraintEntityFilter === type
                          ? 'bg-purple-600 text-white shadow-md'
                          : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                          }`}
                      >
                        {type === 'all' ? 'Tümü' : type === 'teacher' ? 'Öğretmen' : type === 'class' ? 'Sınıf' : 'Ders'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">Kısıtlama Tipi:</span>
                  <div className="flex gap-1">
                    {(['all', 'unavailable', 'preferred', 'restricted'] as const).map((type) => (
                      <button
                        key={type}
                        onClick={() => setConstraintTypeFilter(type)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${constraintTypeFilter === type
                          ? 'bg-purple-600 text-white shadow-md'
                          : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                          }`}
                      >
                        {type === 'all' ? 'Tümü' : CONSTRAINT_TYPES[type].label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Tablo */}
              <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Varlık Tipi</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Varlık Adı</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Gün</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Ders Saati</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Kısıtlama</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Açıklama</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {filteredConstraints.map((constraint, idx) => (
                      <tr key={constraint.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${constraint.entityType === 'teacher' ? 'bg-blue-100 text-blue-800' :
                            constraint.entityType === 'class' ? 'bg-emerald-100 text-emerald-800' :
                              'bg-indigo-100 text-indigo-800'
                            }`}>
                            {constraint.entityType === 'teacher' ? 'Öğretmen' : constraint.entityType === 'class' ? 'Sınıf' : 'Ders'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{getEntityName(constraint.entityType, constraint.entityId)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{constraint.day}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{constraint.period}. Ders</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${CONSTRAINT_TYPES[constraint.constraintType].color}`}>
                            {CONSTRAINT_TYPES[constraint.constraintType].icon} {CONSTRAINT_TYPES[constraint.constraintType].label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{constraint.reason || '-'}</td>
                      </tr>
                    ))}
                    {filteredConstraints.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500">Bu filtreye uygun kısıtlama bulunamadı.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between items-center pt-2">
                <span className="text-sm text-gray-500">{filteredConstraints.length} / {allConstraints.length} kısıtlama gösteriliyor</span>
                <Button onClick={() => setIsConstraintsModalOpen(false)} variant="primary">Kapat</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <ConfirmationModal
        isOpen={confirmation.isOpen}
        onClose={hideConfirmation}
        onConfirm={confirmation.onConfirm}
        title={confirmation.title}
        message={confirmation.message}
        type={confirmation.type}
        confirmVariant={confirmation.confirmVariant}
      />
    </div >
  );
};

export default DataManagement;
