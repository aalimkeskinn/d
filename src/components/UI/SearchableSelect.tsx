import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';

interface Option {
    value: string;
    label: string;
}

interface SearchableSelectProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Option[];
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    className?: string;
}

const SearchableSelect: React.FC<SearchableSelectProps> = ({
    label,
    value,
    onChange,
    options,
    placeholder = 'Seçiniz...',
    required = false,
    disabled = false,
    className = ''
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(opt => opt.value === value);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Filter options based on search term
    const filteredOptions = options.filter(option =>
        option.label.toLocaleLowerCase('tr-TR').includes(searchTerm.toLocaleLowerCase('tr-TR'))
    );

    const handleSelect = (optionValue: string) => {
        onChange(optionValue);
        setIsOpen(false);
        setSearchTerm('');
    };

    const clearSelection = (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange('');
        setSearchTerm('');
    };

    return (
        <div className={`mb-4 ${className}`} ref={wrapperRef}>
            <label className="block text-sm font-semibold text-ide-gray-800 mb-2">
                {label} {required && <span className="text-ide-accent-600 ml-1">*</span>}
            </label>
            <div className="relative">
                <div
                    onClick={() => !disabled && setIsOpen(!isOpen)}
                    className={`
            ide-input w-full min-h-[42px] px-3 py-2 flex items-center justify-between cursor-pointer
            border rounded-lg bg-white transition-all duration-200
            ${isOpen ? 'border-ide-primary-500 ring-2 ring-ide-primary-200' : 'border-ide-gray-300 hover:border-ide-gray-400'}
            ${disabled ? 'bg-ide-gray-50 border-ide-gray-200 cursor-not-allowed opacity-75' : ''}
          `}
                >
                    <span className={`block truncate ${!selectedOption ? 'text-gray-500' : 'text-gray-900'} select-none`}>
                        {selectedOption ? selectedOption.label : placeholder}
                    </span>
                    <div className="flex items-center space-x-1">
                        {value && !disabled && (
                            <div
                                role="button"
                                onClick={clearSelection}
                                className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                            >
                                <X size={14} />
                            </div>
                        )}
                        <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isOpen ? 'transform rotate-180' : ''}`} />
                    </div>
                </div>

                {isOpen && !disabled && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                        <div className="p-2 border-b border-gray-100 bg-gray-50">
                            <div className="relative">
                                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Ara..."
                                    className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-ide-primary-500 focus:ring-1 focus:ring-ide-primary-200"
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                />
                            </div>
                        </div>
                        <div className="max-h-60 overflow-y-auto overflow-x-hidden">
                            {filteredOptions.length > 0 ? (
                                <div className="py-1">
                                    {filteredOptions.map((option) => (
                                        <div
                                            key={option.value}
                                            onClick={() => handleSelect(option.value)}
                                            className={`
                        px-4 py-2 text-sm cursor-pointer flex items-center justify-between
                        ${value === option.value ? 'bg-ide-primary-50 text-ide-primary-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}
                      `}
                                        >
                                            <span>{option.label}</span>
                                            {value === option.value && <Check className="w-4 h-4 text-ide-primary-600" />}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="px-4 py-3 text-sm text-gray-500 text-center italic">
                                    Sonuç bulunamadı
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SearchableSelect;
