/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC Type Aliases
 * Generated from EXPRESS schema: IFC4X3_DEV_923b0514
 *
 * DO NOT EDIT - This file is auto-generated
 */

/** IfcAbsorbedDoseMeasure */
export type IfcAbsorbedDoseMeasure = number;

/** IfcAccelerationMeasure */
export type IfcAccelerationMeasure = number;

/** IfcAmountOfSubstanceMeasure */
export type IfcAmountOfSubstanceMeasure = number;

/** IfcAngularVelocityMeasure */
export type IfcAngularVelocityMeasure = number;

/** IfcArcIndex */
export type IfcArcIndex = LIST [3:3] OF IfcPositiveInteger;

/** IfcAreaDensityMeasure */
export type IfcAreaDensityMeasure = number;

/** IfcAreaMeasure */
export type IfcAreaMeasure = number;

/** IfcBinary */
export type IfcBinary = string;

/** IfcBoolean */
export type IfcBoolean = boolean;

/** IfcBoxAlignment */
export type IfcBoxAlignment = IfcLabel;

/** IfcCardinalPointReference */
export type IfcCardinalPointReference = number;

/** IfcComplexNumber */
export type IfcComplexNumber = ARRAY [1:2] OF REAL;

/** IfcCompoundPlaneAngleMeasure */
export type IfcCompoundPlaneAngleMeasure = LIST [3:4] OF INTEGER;

/** IfcContextDependentMeasure */
export type IfcContextDependentMeasure = number;

/** IfcCountMeasure */
export type IfcCountMeasure = number;

/** IfcCurvatureMeasure */
export type IfcCurvatureMeasure = number;

/** IfcDate */
export type IfcDate = string;

/** IfcDateTime */
export type IfcDateTime = string;

/** IfcDayInMonthNumber */
export type IfcDayInMonthNumber = number;

/** IfcDayInWeekNumber */
export type IfcDayInWeekNumber = number;

/** IfcDescriptiveMeasure */
export type IfcDescriptiveMeasure = string;

/** IfcDimensionCount */
export type IfcDimensionCount = number;

/** IfcDoseEquivalentMeasure */
export type IfcDoseEquivalentMeasure = number;

/** IfcDuration */
export type IfcDuration = string;

/** IfcDynamicViscosityMeasure */
export type IfcDynamicViscosityMeasure = number;

/** IfcElectricCapacitanceMeasure */
export type IfcElectricCapacitanceMeasure = number;

/** IfcElectricChargeMeasure */
export type IfcElectricChargeMeasure = number;

/** IfcElectricConductanceMeasure */
export type IfcElectricConductanceMeasure = number;

/** IfcElectricCurrentMeasure */
export type IfcElectricCurrentMeasure = number;

/** IfcElectricResistanceMeasure */
export type IfcElectricResistanceMeasure = number;

/** IfcElectricVoltageMeasure */
export type IfcElectricVoltageMeasure = number;

/** IfcEnergyMeasure */
export type IfcEnergyMeasure = number;

/** IfcFontStyle */
export type IfcFontStyle = string;

/** IfcFontVariant */
export type IfcFontVariant = string;

/** IfcFontWeight */
export type IfcFontWeight = string;

/** IfcForceMeasure */
export type IfcForceMeasure = number;

/** IfcFrequencyMeasure */
export type IfcFrequencyMeasure = number;

/** IfcGloballyUniqueId */
export type IfcGloballyUniqueId = STRING(22) FIXED;

/** IfcHeatFluxDensityMeasure */
export type IfcHeatFluxDensityMeasure = number;

/** IfcHeatingValueMeasure */
export type IfcHeatingValueMeasure = number;

/** IfcIdentifier */
export type IfcIdentifier = STRING(255);

/** IfcIlluminanceMeasure */
export type IfcIlluminanceMeasure = number;

/** IfcInductanceMeasure */
export type IfcInductanceMeasure = number;

/** IfcInteger */
export type IfcInteger = number;

/** IfcIntegerCountRateMeasure */
export type IfcIntegerCountRateMeasure = number;

/** IfcIonConcentrationMeasure */
export type IfcIonConcentrationMeasure = number;

/** IfcIsothermalMoistureCapacityMeasure */
export type IfcIsothermalMoistureCapacityMeasure = number;

/** IfcKinematicViscosityMeasure */
export type IfcKinematicViscosityMeasure = number;

/** IfcLabel */
export type IfcLabel = STRING(255);

/** IfcLanguageId */
export type IfcLanguageId = IfcIdentifier;

/** IfcLengthMeasure */
export type IfcLengthMeasure = number;

/** IfcLineIndex */
export type IfcLineIndex = LIST [2:?] OF IfcPositiveInteger;

/** IfcLinearForceMeasure */
export type IfcLinearForceMeasure = number;

/** IfcLinearMomentMeasure */
export type IfcLinearMomentMeasure = number;

/** IfcLinearStiffnessMeasure */
export type IfcLinearStiffnessMeasure = number;

/** IfcLinearVelocityMeasure */
export type IfcLinearVelocityMeasure = number;

/** IfcLogical */
export type IfcLogical = boolean | null;

/** IfcLuminousFluxMeasure */
export type IfcLuminousFluxMeasure = number;

/** IfcLuminousIntensityDistributionMeasure */
export type IfcLuminousIntensityDistributionMeasure = number;

/** IfcLuminousIntensityMeasure */
export type IfcLuminousIntensityMeasure = number;

/** IfcMagneticFluxDensityMeasure */
export type IfcMagneticFluxDensityMeasure = number;

/** IfcMagneticFluxMeasure */
export type IfcMagneticFluxMeasure = number;

/** IfcMassDensityMeasure */
export type IfcMassDensityMeasure = number;

/** IfcMassFlowRateMeasure */
export type IfcMassFlowRateMeasure = number;

/** IfcMassMeasure */
export type IfcMassMeasure = number;

/** IfcMassPerLengthMeasure */
export type IfcMassPerLengthMeasure = number;

/** IfcModulusOfElasticityMeasure */
export type IfcModulusOfElasticityMeasure = number;

/** IfcModulusOfLinearSubgradeReactionMeasure */
export type IfcModulusOfLinearSubgradeReactionMeasure = number;

/** IfcModulusOfRotationalSubgradeReactionMeasure */
export type IfcModulusOfRotationalSubgradeReactionMeasure = number;

/** IfcModulusOfSubgradeReactionMeasure */
export type IfcModulusOfSubgradeReactionMeasure = number;

/** IfcMoistureDiffusivityMeasure */
export type IfcMoistureDiffusivityMeasure = number;

/** IfcMolecularWeightMeasure */
export type IfcMolecularWeightMeasure = number;

/** IfcMomentOfInertiaMeasure */
export type IfcMomentOfInertiaMeasure = number;

/** IfcMonetaryMeasure */
export type IfcMonetaryMeasure = number;

/** IfcMonthInYearNumber */
export type IfcMonthInYearNumber = number;

/** IfcNonNegativeLengthMeasure */
export type IfcNonNegativeLengthMeasure = number;

/** IfcNormalisedRatioMeasure */
export type IfcNormalisedRatioMeasure = number;

/** IfcNumericMeasure */
export type IfcNumericMeasure = number;

/** IfcPHMeasure */
export type IfcPHMeasure = number;

/** IfcParameterValue */
export type IfcParameterValue = number;

/** IfcPlanarForceMeasure */
export type IfcPlanarForceMeasure = number;

/** IfcPlaneAngleMeasure */
export type IfcPlaneAngleMeasure = number;

/** IfcPositiveInteger */
export type IfcPositiveInteger = IfcInteger;

/** IfcPositiveLengthMeasure */
export type IfcPositiveLengthMeasure = number;

/** IfcPositivePlaneAngleMeasure */
export type IfcPositivePlaneAngleMeasure = number;

/** IfcPositiveRatioMeasure */
export type IfcPositiveRatioMeasure = number;

/** IfcPowerMeasure */
export type IfcPowerMeasure = number;

/** IfcPresentableText */
export type IfcPresentableText = string;

/** IfcPressureMeasure */
export type IfcPressureMeasure = number;

/** IfcPropertySetDefinitionSet */
export type IfcPropertySetDefinitionSet = SET [1:?] OF IfcPropertySetDefinition;

/** IfcRadioActivityMeasure */
export type IfcRadioActivityMeasure = number;

/** IfcRatioMeasure */
export type IfcRatioMeasure = number;

/** IfcReal */
export type IfcReal = number;

/** IfcRotationalFrequencyMeasure */
export type IfcRotationalFrequencyMeasure = number;

/** IfcRotationalMassMeasure */
export type IfcRotationalMassMeasure = number;

/** IfcRotationalStiffnessMeasure */
export type IfcRotationalStiffnessMeasure = number;

/** IfcSectionModulusMeasure */
export type IfcSectionModulusMeasure = number;

/** IfcSectionalAreaIntegralMeasure */
export type IfcSectionalAreaIntegralMeasure = number;

/** IfcShearModulusMeasure */
export type IfcShearModulusMeasure = number;

/** IfcSolidAngleMeasure */
export type IfcSolidAngleMeasure = number;

/** IfcSoundPowerLevelMeasure */
export type IfcSoundPowerLevelMeasure = number;

/** IfcSoundPowerMeasure */
export type IfcSoundPowerMeasure = number;

/** IfcSoundPressureLevelMeasure */
export type IfcSoundPressureLevelMeasure = number;

/** IfcSoundPressureMeasure */
export type IfcSoundPressureMeasure = number;

/** IfcSpecificHeatCapacityMeasure */
export type IfcSpecificHeatCapacityMeasure = number;

/** IfcSpecularExponent */
export type IfcSpecularExponent = number;

/** IfcSpecularRoughness */
export type IfcSpecularRoughness = number;

/** IfcStrippedOptional */
export type IfcStrippedOptional = boolean;

/** IfcTemperatureGradientMeasure */
export type IfcTemperatureGradientMeasure = number;

/** IfcTemperatureRateOfChangeMeasure */
export type IfcTemperatureRateOfChangeMeasure = number;

/** IfcText */
export type IfcText = string;

/** IfcTextAlignment */
export type IfcTextAlignment = string;

/** IfcTextDecoration */
export type IfcTextDecoration = string;

/** IfcTextFontName */
export type IfcTextFontName = string;

/** IfcTextTransformation */
export type IfcTextTransformation = string;

/** IfcThermalAdmittanceMeasure */
export type IfcThermalAdmittanceMeasure = number;

/** IfcThermalConductivityMeasure */
export type IfcThermalConductivityMeasure = number;

/** IfcThermalExpansionCoefficientMeasure */
export type IfcThermalExpansionCoefficientMeasure = number;

/** IfcThermalResistanceMeasure */
export type IfcThermalResistanceMeasure = number;

/** IfcThermalTransmittanceMeasure */
export type IfcThermalTransmittanceMeasure = number;

/** IfcThermodynamicTemperatureMeasure */
export type IfcThermodynamicTemperatureMeasure = number;

/** IfcTime */
export type IfcTime = string;

/** IfcTimeMeasure */
export type IfcTimeMeasure = number;

/** IfcTimeStamp */
export type IfcTimeStamp = number;

/** IfcTorqueMeasure */
export type IfcTorqueMeasure = number;

/** IfcURIReference */
export type IfcURIReference = string;

/** IfcVaporPermeabilityMeasure */
export type IfcVaporPermeabilityMeasure = number;

/** IfcVolumeMeasure */
export type IfcVolumeMeasure = number;

/** IfcVolumetricFlowRateMeasure */
export type IfcVolumetricFlowRateMeasure = number;

/** IfcWarpingConstantMeasure */
export type IfcWarpingConstantMeasure = number;

/** IfcWarpingMomentMeasure */
export type IfcWarpingMomentMeasure = number;

/** IfcWellKnownTextLiteral */
export type IfcWellKnownTextLiteral = string;

/** IfcActionRequestTypeEnum */
export type IfcActionRequestTypeEnum = ENUMERATION OF
	(EMAIL
	,FAX
	,PHONE
	,POST
	,VERBAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcActionSourceTypeEnum */
export type IfcActionSourceTypeEnum = ENUMERATION OF
	(BRAKES
	,BUOYANCY
	,COMPLETION_G1
	,CREEP
	,CURRENT
	,DEAD_LOAD_G
	,EARTHQUAKE_E
	,ERECTION
	,FIRE
	,ICE
	,IMPACT
	,IMPULSE
	,LACK_OF_FIT
	,LIVE_LOAD_Q
	,PRESTRESSING_P
	,PROPPING
	,RAIN
	,SETTLEMENT_U
	,SHRINKAGE
	,SNOW_S
	,SYSTEM_IMPERFECTION
	,TEMPERATURE_T
	,TRANSPORT
	,WAVE
	,WIND_W
	,USERDEFINED
	,NOTDEFINED);

/** IfcActionTypeEnum */
export type IfcActionTypeEnum = ENUMERATION OF
	(EXTRAORDINARY_A
	,PERMANENT_G
	,VARIABLE_Q
	,USERDEFINED
	,NOTDEFINED);

/** IfcActuatorTypeEnum */
export type IfcActuatorTypeEnum = ENUMERATION OF
	(ELECTRICACTUATOR
	,HANDOPERATEDACTUATOR
	,HYDRAULICACTUATOR
	,PNEUMATICACTUATOR
	,THERMOSTATICACTUATOR
	,USERDEFINED
	,NOTDEFINED);

/** IfcAddressTypeEnum */
export type IfcAddressTypeEnum = ENUMERATION OF
	(DISTRIBUTIONPOINT
	,HOME
	,OFFICE
	,SITE
	,USERDEFINED);

/** IfcAirTerminalBoxTypeEnum */
export type IfcAirTerminalBoxTypeEnum = ENUMERATION OF
	(CONSTANTFLOW
	,VARIABLEFLOWPRESSUREDEPENDANT
	,VARIABLEFLOWPRESSUREINDEPENDANT
	,USERDEFINED
	,NOTDEFINED);

/** IfcAirTerminalTypeEnum */
export type IfcAirTerminalTypeEnum = ENUMERATION OF
	(DIFFUSER
	,GRILLE
	,LOUVRE
	,REGISTER
	,USERDEFINED
	,NOTDEFINED);

/** IfcAirToAirHeatRecoveryTypeEnum */
export type IfcAirToAirHeatRecoveryTypeEnum = ENUMERATION OF
	(FIXEDPLATECOUNTERFLOWEXCHANGER
	,FIXEDPLATECROSSFLOWEXCHANGER
	,FIXEDPLATEPARALLELFLOWEXCHANGER
	,HEATPIPE
	,ROTARYWHEEL
	,RUNAROUNDCOILLOOP
	,THERMOSIPHONCOILTYPEHEATEXCHANGERS
	,THERMOSIPHONSEALEDTUBEHEATEXCHANGERS
	,TWINTOWERENTHALPYRECOVERYLOOPS
	,USERDEFINED
	,NOTDEFINED);

/** IfcAlarmTypeEnum */
export type IfcAlarmTypeEnum = ENUMERATION OF
	(BELL
	,BREAKGLASSBUTTON
	,LIGHT
	,MANUALPULLBOX
	,RAILWAYCROCODILE
	,RAILWAYDETONATOR
	,SIREN
	,WHISTLE
	,USERDEFINED
	,NOTDEFINED);

/** IfcAlignmentCantSegmentTypeEnum */
export type IfcAlignmentCantSegmentTypeEnum = ENUMERATION OF
	(BLOSSCURVE
	,CONSTANTCANT
	,COSINECURVE
	,HELMERTCURVE
	,LINEARTRANSITION
	,SINECURVE
	,VIENNESEBEND);

/** IfcAlignmentHorizontalSegmentTypeEnum */
export type IfcAlignmentHorizontalSegmentTypeEnum = ENUMERATION OF
	(BLOSSCURVE
	,CIRCULARARC
	,CLOTHOID
	,COSINECURVE
	,CUBIC
	,HELMERTCURVE
	,LINE
	,SINECURVE
	,VIENNESEBEND);

/** IfcAlignmentTypeEnum */
export type IfcAlignmentTypeEnum = ENUMERATION OF
	(USERDEFINED
	,NOTDEFINED);

/** IfcAlignmentVerticalSegmentTypeEnum */
export type IfcAlignmentVerticalSegmentTypeEnum = ENUMERATION OF
	(CIRCULARARC
	,CLOTHOID
	,CONSTANTGRADIENT
	,PARABOLICARC);

/** IfcAnalysisModelTypeEnum */
export type IfcAnalysisModelTypeEnum = ENUMERATION OF
	(IN_PLANE_LOADING_2D
	,LOADING_3D
	,OUT_PLANE_LOADING_2D
	,USERDEFINED
	,NOTDEFINED);

/** IfcAnalysisTheoryTypeEnum */
export type IfcAnalysisTheoryTypeEnum = ENUMERATION OF
	(FIRST_ORDER_THEORY
	,FULL_NONLINEAR_THEORY
	,SECOND_ORDER_THEORY
	,THIRD_ORDER_THEORY
	,USERDEFINED
	,NOTDEFINED);

/** IfcAnnotationTypeEnum */
export type IfcAnnotationTypeEnum = ENUMERATION OF
	(CONTOURLINE
	,DIMENSION
	,ISOBAR
	,ISOLUX
	,ISOTHERM
	,LEADER
	,SURVEY
	,SYMBOL
	,TEXT
	,USERDEFINED
	,NOTDEFINED);

/** IfcArithmeticOperatorEnum */
export type IfcArithmeticOperatorEnum = ENUMERATION OF
	(ADD
	,DIVIDE
	,MODULO
	,MULTIPLY
	,SUBTRACT);

/** IfcAssemblyPlaceEnum */
export type IfcAssemblyPlaceEnum = ENUMERATION OF
	(FACTORY
	,SITE
	,NOTDEFINED);

/** IfcAudioVisualApplianceTypeEnum */
export type IfcAudioVisualApplianceTypeEnum = ENUMERATION OF
	(AMPLIFIER
	,CAMERA
	,COMMUNICATIONTERMINAL
	,DISPLAY
	,MICROPHONE
	,PLAYER
	,PROJECTOR
	,RECEIVER
	,RECORDINGEQUIPMENT
	,SPEAKER
	,SWITCHER
	,TELEPHONE
	,TUNER
	,USERDEFINED
	,NOTDEFINED);

/** IfcBSplineCurveForm */
export type IfcBSplineCurveForm = ENUMERATION OF
	(CIRCULAR_ARC
	,ELLIPTIC_ARC
	,HYPERBOLIC_ARC
	,PARABOLIC_ARC
	,POLYLINE_FORM
	,UNSPECIFIED);

/** IfcBSplineSurfaceForm */
export type IfcBSplineSurfaceForm = ENUMERATION OF
	(CONICAL_SURF
	,CYLINDRICAL_SURF
	,GENERALISED_CONE
	,PLANE_SURF
	,QUADRIC_SURF
	,RULED_SURF
	,SPHERICAL_SURF
	,SURF_OF_LINEAR_EXTRUSION
	,SURF_OF_REVOLUTION
	,TOROIDAL_SURF
	,UNSPECIFIED);

/** IfcBeamTypeEnum */
export type IfcBeamTypeEnum = ENUMERATION OF
	(BEAM
	,CORNICE
	,DIAPHRAGM
	,EDGEBEAM
	,GIRDER_SEGMENT
	,HATSTONE
	,HOLLOWCORE
	,JOIST
	,LINTEL
	,PIERCAP
	,SPANDREL
	,T_BEAM
	,USERDEFINED
	,NOTDEFINED);

/** IfcBearingTypeEnum */
export type IfcBearingTypeEnum = ENUMERATION OF
	(CYLINDRICAL
	,DISK
	,ELASTOMERIC
	,GUIDE
	,POT
	,ROCKER
	,ROLLER
	,SPHERICAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcBenchmarkEnum */
export type IfcBenchmarkEnum = ENUMERATION OF
	(EQUALTO
	,GREATERTHAN
	,GREATERTHANOREQUALTO
	,INCLUDEDIN
	,INCLUDES
	,LESSTHAN
	,LESSTHANOREQUALTO
	,NOTEQUALTO
	,NOTINCLUDEDIN
	,NOTINCLUDES);

/** IfcBoilerTypeEnum */
export type IfcBoilerTypeEnum = ENUMERATION OF
	(STEAM
	,WATER
	,USERDEFINED
	,NOTDEFINED);

/** IfcBooleanOperator */
export type IfcBooleanOperator = ENUMERATION OF
	(DIFFERENCE
	,INTERSECTION
	,UNION);

/** IfcBridgePartTypeEnum */
export type IfcBridgePartTypeEnum = ENUMERATION OF
	(ABUTMENT
	,DECK
	,DECK_SEGMENT
	,FOUNDATION
	,PIER
	,PIER_SEGMENT
	,PYLON
	,SUBSTRUCTURE
	,SUPERSTRUCTURE
	,SURFACESTRUCTURE
	,USERDEFINED
	,NOTDEFINED);

/** IfcBridgeTypeEnum */
export type IfcBridgeTypeEnum = ENUMERATION OF
	(ARCHED
	,CABLE_STAYED
	,CANTILEVER
	,CULVERT
	,FRAMEWORK
	,GIRDER
	,SUSPENSION
	,TRUSS
	,USERDEFINED
	,NOTDEFINED);

/** IfcBuildingElementPartTypeEnum */
export type IfcBuildingElementPartTypeEnum = ENUMERATION OF
	(APRON
	,ARMOURUNIT
	,INSULATION
	,PRECASTPANEL
	,SAFETYCAGE
	,USERDEFINED
	,NOTDEFINED);

/** IfcBuildingElementProxyTypeEnum */
export type IfcBuildingElementProxyTypeEnum = ENUMERATION OF
	(COMPLEX
	,ELEMENT
	,PARTIAL
	,PROVISIONFORSPACE
	,PROVISIONFORVOID
	,USERDEFINED
	,NOTDEFINED);

/** IfcBuildingSystemTypeEnum */
export type IfcBuildingSystemTypeEnum = ENUMERATION OF
	(FENESTRATION
	,FOUNDATION
	,LOADBEARING
	,OUTERSHELL
	,SHADING
	,TRANSPORT
	,USERDEFINED
	,NOTDEFINED);

/** IfcBuiltSystemTypeEnum */
export type IfcBuiltSystemTypeEnum = ENUMERATION OF
	(EROSIONPREVENTION
	,FENESTRATION
	,FOUNDATION
	,LOADBEARING
	,MOORING
	,OUTERSHELL
	,PRESTRESSING
	,RAILWAYLINE
	,RAILWAYTRACK
	,REINFORCING
	,SHADING
	,TRACKCIRCUIT
	,TRANSPORT
	,USERDEFINED
	,NOTDEFINED);

/** IfcBurnerTypeEnum */
export type IfcBurnerTypeEnum = ENUMERATION OF
	(USERDEFINED
	,NOTDEFINED);

/** IfcCableCarrierFittingTypeEnum */
export type IfcCableCarrierFittingTypeEnum = ENUMERATION OF
	(BEND
	,CONNECTOR
	,CROSS
	,JUNCTION
	,REDUCER
	,TEE
	,TRANSITION
	,USERDEFINED
	,NOTDEFINED);

/** IfcCableCarrierSegmentTypeEnum */
export type IfcCableCarrierSegmentTypeEnum = ENUMERATION OF
	(CABLEBRACKET
	,CABLELADDERSEGMENT
	,CABLETRAYSEGMENT
	,CABLETRUNKINGSEGMENT
	,CATENARYWIRE
	,CONDUITSEGMENT
	,DROPPER
	,USERDEFINED
	,NOTDEFINED);

/** IfcCableFittingTypeEnum */
export type IfcCableFittingTypeEnum = ENUMERATION OF
	(CONNECTOR
	,ENTRY
	,EXIT
	,FANOUT
	,JUNCTION
	,TRANSITION
	,USERDEFINED
	,NOTDEFINED);

/** IfcCableSegmentTypeEnum */
export type IfcCableSegmentTypeEnum = ENUMERATION OF
	(BUSBARSEGMENT
	,CABLESEGMENT
	,CONDUCTORSEGMENT
	,CONTACTWIRESEGMENT
	,CORESEGMENT
	,FIBERSEGMENT
	,FIBERTUBE
	,OPTICALCABLESEGMENT
	,STITCHWIRE
	,WIREPAIRSEGMENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcCaissonFoundationTypeEnum */
export type IfcCaissonFoundationTypeEnum = ENUMERATION OF
	(CAISSON
	,WELL
	,USERDEFINED
	,NOTDEFINED);

/** IfcChangeActionEnum */
export type IfcChangeActionEnum = ENUMERATION OF
	(ADDED
	,DELETED
	,MODIFIED
	,NOCHANGE
	,NOTDEFINED);

/** IfcChillerTypeEnum */
export type IfcChillerTypeEnum = ENUMERATION OF
	(AIRCOOLED
	,HEATRECOVERY
	,WATERCOOLED
	,USERDEFINED
	,NOTDEFINED);

/** IfcChimneyTypeEnum */
export type IfcChimneyTypeEnum = ENUMERATION OF
	(USERDEFINED
	,NOTDEFINED);

/** IfcCoilTypeEnum */
export type IfcCoilTypeEnum = ENUMERATION OF
	(DXCOOLINGCOIL
	,ELECTRICHEATINGCOIL
	,GASHEATINGCOIL
	,HYDRONICCOIL
	,STEAMHEATINGCOIL
	,WATERCOOLINGCOIL
	,WATERHEATINGCOIL
	,USERDEFINED
	,NOTDEFINED);

/** IfcColumnTypeEnum */
export type IfcColumnTypeEnum = ENUMERATION OF
	(COLUMN
	,PIERSTEM
	,PIERSTEM_SEGMENT
	,PILASTER
	,STANDCOLUMN
	,USERDEFINED
	,NOTDEFINED);

/** IfcCommunicationsApplianceTypeEnum */
export type IfcCommunicationsApplianceTypeEnum = ENUMERATION OF
	(ANTENNA
	,AUTOMATON
	,COMPUTER
	,FAX
	,GATEWAY
	,INTELLIGENTPERIPHERAL
	,IPNETWORKEQUIPMENT
	,LINESIDEELECTRONICUNIT
	,MODEM
	,NETWORKAPPLIANCE
	,NETWORKBRIDGE
	,NETWORKHUB
	,OPTICALLINETERMINAL
	,OPTICALNETWORKUNIT
	,PRINTER
	,RADIOBLOCKCENTER
	,REPEATER
	,ROUTER
	,SCANNER
	,TELECOMMAND
	,TELEPHONYEXCHANGE
	,TRANSITIONCOMPONENT
	,TRANSPONDER
	,TRANSPORTEQUIPMENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcComplexPropertyTemplateTypeEnum */
export type IfcComplexPropertyTemplateTypeEnum = ENUMERATION OF
	(P_COMPLEX
	,Q_COMPLEX);

/** IfcCompressorTypeEnum */
export type IfcCompressorTypeEnum = ENUMERATION OF
	(BOOSTER
	,DYNAMIC
	,HERMETIC
	,OPENTYPE
	,RECIPROCATING
	,ROLLINGPISTON
	,ROTARY
	,ROTARYVANE
	,SCROLL
	,SEMIHERMETIC
	,SINGLESCREW
	,SINGLESTAGE
	,TROCHOIDAL
	,TWINSCREW
	,WELDEDSHELLHERMETIC
	,USERDEFINED
	,NOTDEFINED);

/** IfcCondenserTypeEnum */
export type IfcCondenserTypeEnum = ENUMERATION OF
	(AIRCOOLED
	,EVAPORATIVECOOLED
	,WATERCOOLED
	,WATERCOOLEDBRAZEDPLATE
	,WATERCOOLEDSHELLCOIL
	,WATERCOOLEDSHELLTUBE
	,WATERCOOLEDTUBEINTUBE
	,USERDEFINED
	,NOTDEFINED);

/** IfcConnectionTypeEnum */
export type IfcConnectionTypeEnum = ENUMERATION OF
	(ATEND
	,ATPATH
	,ATSTART
	,NOTDEFINED);

/** IfcConstraintEnum */
export type IfcConstraintEnum = ENUMERATION OF
	(ADVISORY
	,HARD
	,SOFT
	,USERDEFINED
	,NOTDEFINED);

/** IfcConstructionEquipmentResourceTypeEnum */
export type IfcConstructionEquipmentResourceTypeEnum = ENUMERATION OF
	(DEMOLISHING
	,EARTHMOVING
	,ERECTING
	,HEATING
	,LIGHTING
	,PAVING
	,PUMPING
	,TRANSPORTING
	,USERDEFINED
	,NOTDEFINED);

/** IfcConstructionMaterialResourceTypeEnum */
export type IfcConstructionMaterialResourceTypeEnum = ENUMERATION OF
	(AGGREGATES
	,CONCRETE
	,DRYWALL
	,FUEL
	,GYPSUM
	,MASONRY
	,METAL
	,PLASTIC
	,WOOD
	,USERDEFINED
	,NOTDEFINED);

/** IfcConstructionProductResourceTypeEnum */
export type IfcConstructionProductResourceTypeEnum = ENUMERATION OF
	(ASSEMBLY
	,FORMWORK
	,USERDEFINED
	,NOTDEFINED);

/** IfcControllerTypeEnum */
export type IfcControllerTypeEnum = ENUMERATION OF
	(FLOATING
	,MULTIPOSITION
	,PROGRAMMABLE
	,PROPORTIONAL
	,TWOPOSITION
	,USERDEFINED
	,NOTDEFINED);

/** IfcConveyorSegmentTypeEnum */
export type IfcConveyorSegmentTypeEnum = ENUMERATION OF
	(BELTCONVEYOR
	,BUCKETCONVEYOR
	,CHUTECONVEYOR
	,SCREWCONVEYOR
	,USERDEFINED
	,NOTDEFINED);

/** IfcCooledBeamTypeEnum */
export type IfcCooledBeamTypeEnum = ENUMERATION OF
	(ACTIVE
	,PASSIVE
	,USERDEFINED
	,NOTDEFINED);

/** IfcCoolingTowerTypeEnum */
export type IfcCoolingTowerTypeEnum = ENUMERATION OF
	(MECHANICALFORCEDDRAFT
	,MECHANICALINDUCEDDRAFT
	,NATURALDRAFT
	,USERDEFINED
	,NOTDEFINED);

/** IfcCostItemTypeEnum */
export type IfcCostItemTypeEnum = ENUMERATION OF
	(USERDEFINED
	,NOTDEFINED);

/** IfcCostScheduleTypeEnum */
export type IfcCostScheduleTypeEnum = ENUMERATION OF
	(BUDGET
	,COSTPLAN
	,ESTIMATE
	,PRICEDBILLOFQUANTITIES
	,SCHEDULEOFRATES
	,TENDER
	,UNPRICEDBILLOFQUANTITIES
	,USERDEFINED
	,NOTDEFINED);

/** IfcCourseTypeEnum */
export type IfcCourseTypeEnum = ENUMERATION OF
	(ARMOUR
	,BALLASTBED
	,CORE
	,FILTER
	,PAVEMENT
	,PROTECTION
	,USERDEFINED
	,NOTDEFINED);

/** IfcCoveringTypeEnum */
export type IfcCoveringTypeEnum = ENUMERATION OF
	(CEILING
	,CLADDING
	,COPING
	,FLOORING
	,INSULATION
	,MEMBRANE
	,MOLDING
	,ROOFING
	,SKIRTINGBOARD
	,SLEEVING
	,TOPPING
	,WRAPPING
	,USERDEFINED
	,NOTDEFINED);

/** IfcCrewResourceTypeEnum */
export type IfcCrewResourceTypeEnum = ENUMERATION OF
	(OFFICE
	,SITE
	,USERDEFINED
	,NOTDEFINED);

/** IfcCurtainWallTypeEnum */
export type IfcCurtainWallTypeEnum = ENUMERATION OF
	(USERDEFINED
	,NOTDEFINED);

/** IfcCurveInterpolationEnum */
export type IfcCurveInterpolationEnum = ENUMERATION OF
	(LINEAR
	,LOG_LINEAR
	,LOG_LOG
	,NOTDEFINED);

/** IfcDamperTypeEnum */
export type IfcDamperTypeEnum = ENUMERATION OF
	(BACKDRAFTDAMPER
	,BALANCINGDAMPER
	,BLASTDAMPER
	,CONTROLDAMPER
	,FIREDAMPER
	,FIRESMOKEDAMPER
	,FUMEHOODEXHAUST
	,GRAVITYDAMPER
	,GRAVITYRELIEFDAMPER
	,RELIEFDAMPER
	,SMOKEDAMPER
	,USERDEFINED
	,NOTDEFINED);

/** IfcDataOriginEnum */
export type IfcDataOriginEnum = ENUMERATION OF
	(MEASURED
	,PREDICTED
	,SIMULATED
	,USERDEFINED
	,NOTDEFINED);

/** IfcDerivedUnitEnum */
export type IfcDerivedUnitEnum = ENUMERATION OF
	(ACCELERATIONUNIT
	,ANGULARVELOCITYUNIT
	,AREADENSITYUNIT
	,COMPOUNDPLANEANGLEUNIT
	,CURVATUREUNIT
	,DYNAMICVISCOSITYUNIT
	,HEATFLUXDENSITYUNIT
	,HEATINGVALUEUNIT
	,INTEGERCOUNTRATEUNIT
	,IONCONCENTRATIONUNIT
	,ISOTHERMALMOISTURECAPACITYUNIT
	,KINEMATICVISCOSITYUNIT
	,LINEARFORCEUNIT
	,LINEARMOMENTUNIT
	,LINEARSTIFFNESSUNIT
	,LINEARVELOCITYUNIT
	,LUMINOUSINTENSITYDISTRIBUTIONUNIT
	,MASSDENSITYUNIT
	,MASSFLOWRATEUNIT
	,MASSPERLENGTHUNIT
	,MODULUSOFELASTICITYUNIT
	,MODULUSOFLINEARSUBGRADEREACTIONUNIT
	,MODULUSOFROTATIONALSUBGRADEREACTIONUNIT
	,MODULUSOFSUBGRADEREACTIONUNIT
	,MOISTUREDIFFUSIVITYUNIT
	,MOLECULARWEIGHTUNIT
	,MOMENTOFINERTIAUNIT
	,PHUNIT
	,PLANARFORCEUNIT
	,ROTATIONALFREQUENCYUNIT
	,ROTATIONALMASSUNIT
	,ROTATIONALSTIFFNESSUNIT
	,SECTIONAREAINTEGRALUNIT
	,SECTIONMODULUSUNIT
	,SHEARMODULUSUNIT
	,SOUNDPOWERLEVELUNIT
	,SOUNDPOWERUNIT
	,SOUNDPRESSURELEVELUNIT
	,SOUNDPRESSUREUNIT
	,SPECIFICHEATCAPACITYUNIT
	,TEMPERATUREGRADIENTUNIT
	,TEMPERATURERATEOFCHANGEUNIT
	,THERMALADMITTANCEUNIT
	,THERMALCONDUCTANCEUNIT
	,THERMALEXPANSIONCOEFFICIENTUNIT
	,THERMALRESISTANCEUNIT
	,THERMALTRANSMITTANCEUNIT
	,TORQUEUNIT
	,VAPORPERMEABILITYUNIT
	,VOLUMETRICFLOWRATEUNIT
	,WARPINGCONSTANTUNIT
	,WARPINGMOMENTUNIT
	,USERDEFINED);

/** IfcDirectionSenseEnum */
export type IfcDirectionSenseEnum = ENUMERATION OF
	(NEGATIVE
	,POSITIVE);

/** IfcDiscreteAccessoryTypeEnum */
export type IfcDiscreteAccessoryTypeEnum = ENUMERATION OF
	(ANCHORPLATE
	,BIRDPROTECTION
	,BRACKET
	,CABLEARRANGER
	,ELASTIC_CUSHION
	,EXPANSION_JOINT_DEVICE
	,FILLER
	,FLASHING
	,INSULATOR
	,LOCK
	,PANEL_STRENGTHENING
	,POINTMACHINEMOUNTINGDEVICE
	,POINT_MACHINE_LOCKING_DEVICE
	,RAILBRACE
	,RAILPAD
	,RAIL_LUBRICATION
	,RAIL_MECHANICAL_EQUIPMENT
	,SHOE
	,SLIDINGCHAIR
	,SOUNDABSORPTION
	,TENSIONINGEQUIPMENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcDistributionBoardTypeEnum */
export type IfcDistributionBoardTypeEnum = ENUMERATION OF
	(CONSUMERUNIT
	,DISPATCHINGBOARD
	,DISTRIBUTIONBOARD
	,DISTRIBUTIONFRAME
	,MOTORCONTROLCENTRE
	,SWITCHBOARD
	,USERDEFINED
	,NOTDEFINED);

/** IfcDistributionChamberElementTypeEnum */
export type IfcDistributionChamberElementTypeEnum = ENUMERATION OF
	(FORMEDDUCT
	,INSPECTIONCHAMBER
	,INSPECTIONPIT
	,MANHOLE
	,METERCHAMBER
	,SUMP
	,TRENCH
	,VALVECHAMBER
	,USERDEFINED
	,NOTDEFINED);

/** IfcDistributionPortTypeEnum */
export type IfcDistributionPortTypeEnum = ENUMERATION OF
	(CABLE
	,CABLECARRIER
	,DUCT
	,PIPE
	,WIRELESS
	,USERDEFINED
	,NOTDEFINED);

/** IfcDistributionSystemEnum */
export type IfcDistributionSystemEnum = ENUMERATION OF
	(AIRCONDITIONING
	,AUDIOVISUAL
	,CATENARY_SYSTEM
	,CHEMICAL
	,CHILLEDWATER
	,COMMUNICATION
	,COMPRESSEDAIR
	,CONDENSERWATER
	,CONTROL
	,CONVEYING
	,DATA
	,DISPOSAL
	,DOMESTICCOLDWATER
	,DOMESTICHOTWATER
	,DRAINAGE
	,EARTHING
	,ELECTRICAL
	,ELECTROACOUSTIC
	,EXHAUST
	,FIREPROTECTION
	,FIXEDTRANSMISSIONNETWORK
	,FUEL
	,GAS
	,HAZARDOUS
	,HEATING
	,LIGHTING
	,LIGHTNINGPROTECTION
	,MOBILENETWORK
	,MONITORINGSYSTEM
	,MUNICIPALSOLIDWASTE
	,OIL
	,OPERATIONAL
	,OPERATIONALTELEPHONYSYSTEM
	,OVERHEAD_CONTACTLINE_SYSTEM
	,POWERGENERATION
	,RAINWATER
	,REFRIGERATION
	,RETURN_CIRCUIT
	,SECURITY
	,SEWAGE
	,SIGNAL
	,STORMWATER
	,TELEPHONE
	,TV
	,VACUUM
	,VENT
	,VENTILATION
	,WASTEWATER
	,WATERSUPPLY
	,USERDEFINED
	,NOTDEFINED);

/** IfcDocumentConfidentialityEnum */
export type IfcDocumentConfidentialityEnum = ENUMERATION OF
	(CONFIDENTIAL
	,PERSONAL
	,PUBLIC
	,RESTRICTED
	,USERDEFINED
	,NOTDEFINED);

/** IfcDocumentStatusEnum */
export type IfcDocumentStatusEnum = ENUMERATION OF
	(DRAFT
	,FINAL
	,FINALDRAFT
	,REVISION
	,NOTDEFINED);

/** IfcDoorPanelOperationEnum */
export type IfcDoorPanelOperationEnum = ENUMERATION OF
	(DOUBLE_ACTING
	,FIXEDPANEL
	,FOLDING
	,REVOLVING
	,ROLLINGUP
	,SLIDING
	,SWINGING
	,USERDEFINED
	,NOTDEFINED);

/** IfcDoorPanelPositionEnum */
export type IfcDoorPanelPositionEnum = ENUMERATION OF
	(LEFT
	,MIDDLE
	,RIGHT
	,NOTDEFINED);

/** IfcDoorTypeEnum */
export type IfcDoorTypeEnum = ENUMERATION OF
	(BOOM_BARRIER
	,DOOR
	,GATE
	,TRAPDOOR
	,TURNSTILE
	,USERDEFINED
	,NOTDEFINED);

/** IfcDoorTypeOperationEnum */
export type IfcDoorTypeOperationEnum = ENUMERATION OF
	(DOUBLE_DOOR_DOUBLE_SWING
	,DOUBLE_DOOR_FOLDING
	,DOUBLE_DOOR_LIFTING_VERTICAL
	,DOUBLE_DOOR_SINGLE_SWING
	,DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_LEFT
	,DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_RIGHT
	,DOUBLE_DOOR_SLIDING
	,DOUBLE_SWING_LEFT
	,DOUBLE_SWING_RIGHT
	,FOLDING_TO_LEFT
	,FOLDING_TO_RIGHT
	,LIFTING_HORIZONTAL
	,LIFTING_VERTICAL_LEFT
	,LIFTING_VERTICAL_RIGHT
	,REVOLVING
	,REVOLVING_VERTICAL
	,ROLLINGUP
	,SINGLE_SWING_LEFT
	,SINGLE_SWING_RIGHT
	,SLIDING_TO_LEFT
	,SLIDING_TO_RIGHT
	,SWING_FIXED_LEFT
	,SWING_FIXED_RIGHT
	,USERDEFINED
	,NOTDEFINED);

/** IfcDuctFittingTypeEnum */
export type IfcDuctFittingTypeEnum = ENUMERATION OF
	(BEND
	,CONNECTOR
	,ENTRY
	,EXIT
	,JUNCTION
	,OBSTRUCTION
	,TRANSITION
	,USERDEFINED
	,NOTDEFINED);

/** IfcDuctSegmentTypeEnum */
export type IfcDuctSegmentTypeEnum = ENUMERATION OF
	(FLEXIBLESEGMENT
	,RIGIDSEGMENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcDuctSilencerTypeEnum */
export type IfcDuctSilencerTypeEnum = ENUMERATION OF
	(FLATOVAL
	,RECTANGULAR
	,ROUND
	,USERDEFINED
	,NOTDEFINED);

/** IfcEarthworksCutTypeEnum */
export type IfcEarthworksCutTypeEnum = ENUMERATION OF
	(BASE_EXCAVATION
	,CUT
	,DREDGING
	,EXCAVATION
	,OVEREXCAVATION
	,PAVEMENTMILLING
	,STEPEXCAVATION
	,TOPSOILREMOVAL
	,TRENCH
	,USERDEFINED
	,NOTDEFINED);

/** IfcEarthworksFillTypeEnum */
export type IfcEarthworksFillTypeEnum = ENUMERATION OF
	(BACKFILL
	,COUNTERWEIGHT
	,EMBANKMENT
	,SLOPEFILL
	,SUBGRADE
	,SUBGRADEBED
	,TRANSITIONSECTION
	,USERDEFINED
	,NOTDEFINED);

/** IfcElectricApplianceTypeEnum */
export type IfcElectricApplianceTypeEnum = ENUMERATION OF
	(DISHWASHER
	,ELECTRICCOOKER
	,FREESTANDINGELECTRICHEATER
	,FREESTANDINGFAN
	,FREESTANDINGWATERCOOLER
	,FREESTANDINGWATERHEATER
	,FREEZER
	,FRIDGE_FREEZER
	,HANDDRYER
	,KITCHENMACHINE
	,MICROWAVE
	,PHOTOCOPIER
	,REFRIGERATOR
	,TUMBLEDRYER
	,VENDINGMACHINE
	,WASHINGMACHINE
	,USERDEFINED
	,NOTDEFINED);

/** IfcElectricDistributionBoardTypeEnum */
export type IfcElectricDistributionBoardTypeEnum = ENUMERATION OF
	(CONSUMERUNIT
	,DISTRIBUTIONBOARD
	,MOTORCONTROLCENTRE
	,SWITCHBOARD
	,USERDEFINED
	,NOTDEFINED);

/** IfcElectricFlowStorageDeviceTypeEnum */
export type IfcElectricFlowStorageDeviceTypeEnum = ENUMERATION OF
	(BATTERY
	,CAPACITOR
	,CAPACITORBANK
	,COMPENSATOR
	,HARMONICFILTER
	,INDUCTOR
	,INDUCTORBANK
	,RECHARGER
	,UPS
	,USERDEFINED
	,NOTDEFINED);

/** IfcElectricFlowTreatmentDeviceTypeEnum */
export type IfcElectricFlowTreatmentDeviceTypeEnum = ENUMERATION OF
	(ELECTRONICFILTER
	,USERDEFINED
	,NOTDEFINED);

/** IfcElectricGeneratorTypeEnum */
export type IfcElectricGeneratorTypeEnum = ENUMERATION OF
	(CHP
	,ENGINEGENERATOR
	,STANDALONE
	,USERDEFINED
	,NOTDEFINED);

/** IfcElectricMotorTypeEnum */
export type IfcElectricMotorTypeEnum = ENUMERATION OF
	(DC
	,INDUCTION
	,POLYPHASE
	,RELUCTANCESYNCHRONOUS
	,SYNCHRONOUS
	,USERDEFINED
	,NOTDEFINED);

/** IfcElectricTimeControlTypeEnum */
export type IfcElectricTimeControlTypeEnum = ENUMERATION OF
	(RELAY
	,TIMECLOCK
	,TIMEDELAY
	,USERDEFINED
	,NOTDEFINED);

/** IfcElementAssemblyTypeEnum */
export type IfcElementAssemblyTypeEnum = ENUMERATION OF
	(ABUTMENT
	,ACCESSORY_ASSEMBLY
	,ARCH
	,BEAM_GRID
	,BRACED_FRAME
	,CROSS_BRACING
	,DECK
	,DILATATIONPANEL
	,ENTRANCEWORKS
	,GIRDER
	,GRID
	,MAST
	,PIER
	,PYLON
	,RAIL_MECHANICAL_EQUIPMENT_ASSEMBLY
	,REINFORCEMENT_UNIT
	,RIGID_FRAME
	,SHELTER
	,SIGNALASSEMBLY
	,SLAB_FIELD
	,SUMPBUSTER
	,SUPPORTINGASSEMBLY
	,SUSPENSIONASSEMBLY
	,TRACKPANEL
	,TRACTION_SWITCHING_ASSEMBLY
	,TRAFFIC_CALMING_DEVICE
	,TRUSS
	,TURNOUTPANEL
	,USERDEFINED
	,NOTDEFINED);

/** IfcElementCompositionEnum */
export type IfcElementCompositionEnum = ENUMERATION OF
	(COMPLEX
	,ELEMENT
	,PARTIAL);

/** IfcEngineTypeEnum */
export type IfcEngineTypeEnum = ENUMERATION OF
	(EXTERNALCOMBUSTION
	,INTERNALCOMBUSTION
	,USERDEFINED
	,NOTDEFINED);

/** IfcEvaporativeCoolerTypeEnum */
export type IfcEvaporativeCoolerTypeEnum = ENUMERATION OF
	(DIRECTEVAPORATIVEAIRWASHER
	,DIRECTEVAPORATIVEPACKAGEDROTARYAIRCOOLER
	,DIRECTEVAPORATIVERANDOMMEDIAAIRCOOLER
	,DIRECTEVAPORATIVERIGIDMEDIAAIRCOOLER
	,DIRECTEVAPORATIVESLINGERSPACKAGEDAIRCOOLER
	,INDIRECTDIRECTCOMBINATION
	,INDIRECTEVAPORATIVECOOLINGTOWERORCOILCOOLER
	,INDIRECTEVAPORATIVEPACKAGEAIRCOOLER
	,INDIRECTEVAPORATIVEWETCOIL
	,USERDEFINED
	,NOTDEFINED);

/** IfcEvaporatorTypeEnum */
export type IfcEvaporatorTypeEnum = ENUMERATION OF
	(DIRECTEXPANSION
	,DIRECTEXPANSIONBRAZEDPLATE
	,DIRECTEXPANSIONSHELLANDTUBE
	,DIRECTEXPANSIONTUBEINTUBE
	,FLOODEDSHELLANDTUBE
	,SHELLANDCOIL
	,USERDEFINED
	,NOTDEFINED);

/** IfcEventTriggerTypeEnum */
export type IfcEventTriggerTypeEnum = ENUMERATION OF
	(EVENTCOMPLEX
	,EVENTMESSAGE
	,EVENTRULE
	,EVENTTIME
	,USERDEFINED
	,NOTDEFINED);

/** IfcEventTypeEnum */
export type IfcEventTypeEnum = ENUMERATION OF
	(ENDEVENT
	,INTERMEDIATEEVENT
	,STARTEVENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcExternalSpatialElementTypeEnum */
export type IfcExternalSpatialElementTypeEnum = ENUMERATION OF
	(EXTERNAL
	,EXTERNAL_EARTH
	,EXTERNAL_FIRE
	,EXTERNAL_WATER
	,USERDEFINED
	,NOTDEFINED);

/** IfcFacilityPartCommonTypeEnum */
export type IfcFacilityPartCommonTypeEnum = ENUMERATION OF
	(ABOVEGROUND
	,BELOWGROUND
	,JUNCTION
	,LEVELCROSSING
	,SEGMENT
	,SUBSTRUCTURE
	,SUPERSTRUCTURE
	,TERMINAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcFacilityUsageEnum */
export type IfcFacilityUsageEnum = ENUMERATION OF
	(LATERAL
	,LONGITUDINAL
	,REGION
	,VERTICAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcFanTypeEnum */
export type IfcFanTypeEnum = ENUMERATION OF
	(CENTRIFUGALAIRFOIL
	,CENTRIFUGALBACKWARDINCLINEDCURVED
	,CENTRIFUGALFORWARDCURVED
	,CENTRIFUGALRADIAL
	,PROPELLORAXIAL
	,TUBEAXIAL
	,VANEAXIAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcFastenerTypeEnum */
export type IfcFastenerTypeEnum = ENUMERATION OF
	(GLUE
	,MORTAR
	,WELD
	,USERDEFINED
	,NOTDEFINED);

/** IfcFilterTypeEnum */
export type IfcFilterTypeEnum = ENUMERATION OF
	(AIRPARTICLEFILTER
	,COMPRESSEDAIRFILTER
	,ODORFILTER
	,OILFILTER
	,STRAINER
	,WATERFILTER
	,USERDEFINED
	,NOTDEFINED);

/** IfcFireSuppressionTerminalTypeEnum */
export type IfcFireSuppressionTerminalTypeEnum = ENUMERATION OF
	(BREECHINGINLET
	,FIREHYDRANT
	,FIREMONITOR
	,HOSEREEL
	,SPRINKLER
	,SPRINKLERDEFLECTOR
	,USERDEFINED
	,NOTDEFINED);

/** IfcFlowDirectionEnum */
export type IfcFlowDirectionEnum = ENUMERATION OF
	(SINK
	,SOURCE
	,SOURCEANDSINK
	,NOTDEFINED);

/** IfcFlowInstrumentTypeEnum */
export type IfcFlowInstrumentTypeEnum = ENUMERATION OF
	(AMMETER
	,COMBINED
	,FREQUENCYMETER
	,PHASEANGLEMETER
	,POWERFACTORMETER
	,PRESSUREGAUGE
	,THERMOMETER
	,VOLTMETER
	,VOLTMETER_PEAK
	,VOLTMETER_RMS
	,USERDEFINED
	,NOTDEFINED);

/** IfcFlowMeterTypeEnum */
export type IfcFlowMeterTypeEnum = ENUMERATION OF
	(ENERGYMETER
	,GASMETER
	,OILMETER
	,WATERMETER
	,USERDEFINED
	,NOTDEFINED);

/** IfcFootingTypeEnum */
export type IfcFootingTypeEnum = ENUMERATION OF
	(CAISSON_FOUNDATION
	,FOOTING_BEAM
	,PAD_FOOTING
	,PILE_CAP
	,STRIP_FOOTING
	,USERDEFINED
	,NOTDEFINED);

/** IfcFurnitureTypeEnum */
export type IfcFurnitureTypeEnum = ENUMERATION OF
	(BED
	,CHAIR
	,DESK
	,FILECABINET
	,SHELF
	,SOFA
	,TABLE
	,TECHNICALCABINET
	,USERDEFINED
	,NOTDEFINED);

/** IfcGeographicElementTypeEnum */
export type IfcGeographicElementTypeEnum = ENUMERATION OF
	(SOIL_BORING_POINT
	,TERRAIN
	,VEGETATION
	,USERDEFINED
	,NOTDEFINED);

/** IfcGeometricProjectionEnum */
export type IfcGeometricProjectionEnum = ENUMERATION OF
	(ELEVATION_VIEW
	,GRAPH_VIEW
	,MODEL_VIEW
	,PLAN_VIEW
	,REFLECTED_PLAN_VIEW
	,SECTION_VIEW
	,SKETCH_VIEW
	,USERDEFINED
	,NOTDEFINED);

/** IfcGeotechnicalStratumTypeEnum */
export type IfcGeotechnicalStratumTypeEnum = ENUMERATION OF
	(SOLID
	,VOID
	,WATER
	,USERDEFINED
	,NOTDEFINED);

/** IfcGlobalOrLocalEnum */
export type IfcGlobalOrLocalEnum = ENUMERATION OF
	(GLOBAL_COORDS
	,LOCAL_COORDS);

/** IfcGridTypeEnum */
export type IfcGridTypeEnum = ENUMERATION OF
	(IRREGULAR
	,RADIAL
	,RECTANGULAR
	,TRIANGULAR
	,USERDEFINED
	,NOTDEFINED);

/** IfcHeatExchangerTypeEnum */
export type IfcHeatExchangerTypeEnum = ENUMERATION OF
	(PLATE
	,SHELLANDTUBE
	,TURNOUTHEATING
	,USERDEFINED
	,NOTDEFINED);

/** IfcHumidifierTypeEnum */
export type IfcHumidifierTypeEnum = ENUMERATION OF
	(ADIABATICAIRWASHER
	,ADIABATICATOMIZING
	,ADIABATICCOMPRESSEDAIRNOZZLE
	,ADIABATICPAN
	,ADIABATICRIGIDMEDIA
	,ADIABATICULTRASONIC
	,ADIABATICWETTEDELEMENT
	,ASSISTEDBUTANE
	,ASSISTEDELECTRIC
	,ASSISTEDNATURALGAS
	,ASSISTEDPROPANE
	,ASSISTEDSTEAM
	,STEAMINJECTION
	,USERDEFINED
	,NOTDEFINED);

/** IfcImpactProtectionDeviceTypeEnum */
export type IfcImpactProtectionDeviceTypeEnum = ENUMERATION OF
	(BUMPER
	,CRASHCUSHION
	,DAMPINGSYSTEM
	,FENDER
	,USERDEFINED
	,NOTDEFINED);

/** IfcInterceptorTypeEnum */
export type IfcInterceptorTypeEnum = ENUMERATION OF
	(CYCLONIC
	,GREASE
	,OIL
	,PETROL
	,USERDEFINED
	,NOTDEFINED);

/** IfcInternalOrExternalEnum */
export type IfcInternalOrExternalEnum = ENUMERATION OF
	(EXTERNAL
	,EXTERNAL_EARTH
	,EXTERNAL_FIRE
	,EXTERNAL_WATER
	,INTERNAL
	,NOTDEFINED);

/** IfcInventoryTypeEnum */
export type IfcInventoryTypeEnum = ENUMERATION OF
	(ASSETINVENTORY
	,FURNITUREINVENTORY
	,SPACEINVENTORY
	,USERDEFINED
	,NOTDEFINED);

/** IfcJunctionBoxTypeEnum */
export type IfcJunctionBoxTypeEnum = ENUMERATION OF
	(DATA
	,POWER
	,USERDEFINED
	,NOTDEFINED);

/** IfcKerbTypeEnum */
export type IfcKerbTypeEnum = ENUMERATION OF
	(USERDEFINED
	,NOTDEFINED);

/** IfcKnotType */
export type IfcKnotType = ENUMERATION OF
	(PIECEWISE_BEZIER_KNOTS
	,QUASI_UNIFORM_KNOTS
	,UNIFORM_KNOTS
	,UNSPECIFIED);

/** IfcLaborResourceTypeEnum */
export type IfcLaborResourceTypeEnum = ENUMERATION OF
	(ADMINISTRATION
	,CARPENTRY
	,CLEANING
	,CONCRETE
	,DRYWALL
	,ELECTRIC
	,FINISHING
	,FLOORING
	,GENERAL
	,HVAC
	,LANDSCAPING
	,MASONRY
	,PAINTING
	,PAVING
	,PLUMBING
	,ROOFING
	,SITEGRADING
	,STEELWORK
	,SURVEYING
	,USERDEFINED
	,NOTDEFINED);

/** IfcLampTypeEnum */
export type IfcLampTypeEnum = ENUMERATION OF
	(COMPACTFLUORESCENT
	,FLUORESCENT
	,HALOGEN
	,HIGHPRESSUREMERCURY
	,HIGHPRESSURESODIUM
	,LED
	,METALHALIDE
	,OLED
	,TUNGSTENFILAMENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcLayerSetDirectionEnum */
export type IfcLayerSetDirectionEnum = ENUMERATION OF
	(AXIS1
	,AXIS2
	,AXIS3);

/** IfcLightDistributionCurveEnum */
export type IfcLightDistributionCurveEnum = ENUMERATION OF
	(TYPE_A
	,TYPE_B
	,TYPE_C
	,NOTDEFINED);

/** IfcLightEmissionSourceEnum */
export type IfcLightEmissionSourceEnum = ENUMERATION OF
	(COMPACTFLUORESCENT
	,FLUORESCENT
	,HIGHPRESSUREMERCURY
	,HIGHPRESSURESODIUM
	,LIGHTEMITTINGDIODE
	,LOWPRESSURESODIUM
	,LOWVOLTAGEHALOGEN
	,MAINVOLTAGEHALOGEN
	,METALHALIDE
	,TUNGSTENFILAMENT
	,NOTDEFINED);

/** IfcLightFixtureTypeEnum */
export type IfcLightFixtureTypeEnum = ENUMERATION OF
	(DIRECTIONSOURCE
	,POINTSOURCE
	,SECURITYLIGHTING
	,USERDEFINED
	,NOTDEFINED);

/** IfcLiquidTerminalTypeEnum */
export type IfcLiquidTerminalTypeEnum = ENUMERATION OF
	(HOSEREEL
	,LOADINGARM
	,USERDEFINED
	,NOTDEFINED);

/** IfcLoadGroupTypeEnum */
export type IfcLoadGroupTypeEnum = ENUMERATION OF
	(LOAD_CASE
	,LOAD_COMBINATION
	,LOAD_GROUP
	,USERDEFINED
	,NOTDEFINED);

/** IfcLogicalOperatorEnum */
export type IfcLogicalOperatorEnum = ENUMERATION OF
	(LOGICALAND
	,LOGICALNOTAND
	,LOGICALNOTOR
	,LOGICALOR
	,LOGICALXOR);

/** IfcMarineFacilityTypeEnum */
export type IfcMarineFacilityTypeEnum = ENUMERATION OF
	(BARRIERBEACH
	,BREAKWATER
	,CANAL
	,DRYDOCK
	,FLOATINGDOCK
	,HYDROLIFT
	,JETTY
	,LAUNCHRECOVERY
	,MARINEDEFENCE
	,NAVIGATIONALCHANNEL
	,PORT
	,QUAY
	,REVETMENT
	,SHIPLIFT
	,SHIPLOCK
	,SHIPYARD
	,SLIPWAY
	,WATERWAY
	,WATERWAYSHIPLIFT
	,USERDEFINED
	,NOTDEFINED);

/** IfcMarinePartTypeEnum */
export type IfcMarinePartTypeEnum = ENUMERATION OF
	(ABOVEWATERLINE
	,ANCHORAGE
	,APPROACHCHANNEL
	,BELOWWATERLINE
	,BERTHINGSTRUCTURE
	,CHAMBER
	,CILL_LEVEL
	,COPELEVEL
	,CORE
	,CREST
	,GATEHEAD
	,GUDINGSTRUCTURE
	,HIGHWATERLINE
	,LANDFIELD
	,LEEWARDSIDE
	,LOWWATERLINE
	,MANUFACTURING
	,NAVIGATIONALAREA
	,PROTECTION
	,SHIPTRANSFER
	,STORAGEAREA
	,VEHICLESERVICING
	,WATERFIELD
	,WEATHERSIDE
	,USERDEFINED
	,NOTDEFINED);

/** IfcMechanicalFastenerTypeEnum */
export type IfcMechanicalFastenerTypeEnum = ENUMERATION OF
	(ANCHORBOLT
	,BOLT
	,CHAIN
	,COUPLER
	,DOWEL
	,NAIL
	,NAILPLATE
	,RAILFASTENING
	,RAILJOINT
	,RIVET
	,ROPE
	,SCREW
	,SHEARCONNECTOR
	,STAPLE
	,STUDSHEARCONNECTOR
	,USERDEFINED
	,NOTDEFINED);

/** IfcMedicalDeviceTypeEnum */
export type IfcMedicalDeviceTypeEnum = ENUMERATION OF
	(AIRSTATION
	,FEEDAIRUNIT
	,OXYGENGENERATOR
	,OXYGENPLANT
	,VACUUMSTATION
	,USERDEFINED
	,NOTDEFINED);

/** IfcMemberTypeEnum */
export type IfcMemberTypeEnum = ENUMERATION OF
	(ARCH_SEGMENT
	,BRACE
	,CHORD
	,COLLAR
	,MEMBER
	,MULLION
	,PLATE
	,POST
	,PURLIN
	,RAFTER
	,STAY_CABLE
	,STIFFENING_RIB
	,STRINGER
	,STRUCTURALCABLE
	,STRUT
	,STUD
	,SUSPENDER
	,SUSPENSION_CABLE
	,TIEBAR
	,USERDEFINED
	,NOTDEFINED);

/** IfcMobileTelecommunicationsApplianceTypeEnum */
export type IfcMobileTelecommunicationsApplianceTypeEnum = ENUMERATION OF
	(ACCESSPOINT
	,BASEBANDUNIT
	,BASETRANSCEIVERSTATION
	,E_UTRAN_NODE_B
	,GATEWAY_GPRS_SUPPORT_NODE
	,MASTERUNIT
	,MOBILESWITCHINGCENTER
	,MSCSERVER
	,PACKETCONTROLUNIT
	,REMOTERADIOUNIT
	,REMOTEUNIT
	,SERVICE_GPRS_SUPPORT_NODE
	,SUBSCRIBERSERVER
	,USERDEFINED
	,NOTDEFINED);

/** IfcMooringDeviceTypeEnum */
export type IfcMooringDeviceTypeEnum = ENUMERATION OF
	(BOLLARD
	,LINETENSIONER
	,MAGNETICDEVICE
	,MOORINGHOOKS
	,VACUUMDEVICE
	,USERDEFINED
	,NOTDEFINED);

/** IfcMotorConnectionTypeEnum */
export type IfcMotorConnectionTypeEnum = ENUMERATION OF
	(BELTDRIVE
	,COUPLING
	,DIRECTDRIVE
	,USERDEFINED
	,NOTDEFINED);

/** IfcNavigationElementTypeEnum */
export type IfcNavigationElementTypeEnum = ENUMERATION OF
	(BEACON
	,BUOY
	,USERDEFINED
	,NOTDEFINED);

/** IfcObjectiveEnum */
export type IfcObjectiveEnum = ENUMERATION OF
	(CODECOMPLIANCE
	,CODEWAIVER
	,DESIGNINTENT
	,EXTERNAL
	,HEALTHANDSAFETY
	,MERGECONFLICT
	,MODELVIEW
	,PARAMETER
	,REQUIREMENT
	,SPECIFICATION
	,TRIGGERCONDITION
	,USERDEFINED
	,NOTDEFINED);

/** IfcOccupantTypeEnum */
export type IfcOccupantTypeEnum = ENUMERATION OF
	(ASSIGNEE
	,ASSIGNOR
	,LESSEE
	,LESSOR
	,LETTINGAGENT
	,OWNER
	,TENANT
	,USERDEFINED
	,NOTDEFINED);

/** IfcOpeningElementTypeEnum */
export type IfcOpeningElementTypeEnum = ENUMERATION OF
	(OPENING
	,RECESS
	,USERDEFINED
	,NOTDEFINED);

/** IfcOutletTypeEnum */
export type IfcOutletTypeEnum = ENUMERATION OF
	(AUDIOVISUALOUTLET
	,COMMUNICATIONSOUTLET
	,DATAOUTLET
	,POWEROUTLET
	,TELEPHONEOUTLET
	,USERDEFINED
	,NOTDEFINED);

/** IfcPavementTypeEnum */
export type IfcPavementTypeEnum = ENUMERATION OF
	(FLEXIBLE
	,RIGID
	,USERDEFINED
	,NOTDEFINED);

/** IfcPerformanceHistoryTypeEnum */
export type IfcPerformanceHistoryTypeEnum = ENUMERATION OF
	(USERDEFINED
	,NOTDEFINED);

/** IfcPermeableCoveringOperationEnum */
export type IfcPermeableCoveringOperationEnum = ENUMERATION OF
	(GRILL
	,LOUVER
	,SCREEN
	,USERDEFINED
	,NOTDEFINED);

/** IfcPermitTypeEnum */
export type IfcPermitTypeEnum = ENUMERATION OF
	(ACCESS
	,BUILDING
	,WORK
	,USERDEFINED
	,NOTDEFINED);

/** IfcPhysicalOrVirtualEnum */
export type IfcPhysicalOrVirtualEnum = ENUMERATION OF
	(PHYSICAL
	,VIRTUAL
	,NOTDEFINED);

/** IfcPileConstructionEnum */
export type IfcPileConstructionEnum = ENUMERATION OF
	(CAST_IN_PLACE
	,COMPOSITE
	,PRECAST_CONCRETE
	,PREFAB_STEEL
	,USERDEFINED
	,NOTDEFINED);

/** IfcPileTypeEnum */
export type IfcPileTypeEnum = ENUMERATION OF
	(BORED
	,COHESION
	,DRIVEN
	,FRICTION
	,JETGROUTING
	,SUPPORT
	,USERDEFINED
	,NOTDEFINED);

/** IfcPipeFittingTypeEnum */
export type IfcPipeFittingTypeEnum = ENUMERATION OF
	(BEND
	,CONNECTOR
	,ENTRY
	,EXIT
	,JUNCTION
	,OBSTRUCTION
	,TRANSITION
	,USERDEFINED
	,NOTDEFINED);

/** IfcPipeSegmentTypeEnum */
export type IfcPipeSegmentTypeEnum = ENUMERATION OF
	(CULVERT
	,FLEXIBLESEGMENT
	,GUTTER
	,RIGIDSEGMENT
	,SPOOL
	,USERDEFINED
	,NOTDEFINED);

/** IfcPlateTypeEnum */
export type IfcPlateTypeEnum = ENUMERATION OF
	(BASE_PLATE
	,COVER_PLATE
	,CURTAIN_PANEL
	,FLANGE_PLATE
	,GUSSET_PLATE
	,SHEET
	,SPLICE_PLATE
	,STIFFENER_PLATE
	,WEB_PLATE
	,USERDEFINED
	,NOTDEFINED);

/** IfcPreferredSurfaceCurveRepresentation */
export type IfcPreferredSurfaceCurveRepresentation = ENUMERATION OF
	(CURVE3D
	,PCURVE_S1
	,PCURVE_S2);

/** IfcProcedureTypeEnum */
export type IfcProcedureTypeEnum = ENUMERATION OF
	(ADVICE_CAUTION
	,ADVICE_NOTE
	,ADVICE_WARNING
	,CALIBRATION
	,DIAGNOSTIC
	,SHUTDOWN
	,STARTUP
	,USERDEFINED
	,NOTDEFINED);

/** IfcProfileTypeEnum */
export type IfcProfileTypeEnum = ENUMERATION OF
	(AREA
	,CURVE);

/** IfcProjectOrderTypeEnum */
export type IfcProjectOrderTypeEnum = ENUMERATION OF
	(CHANGEORDER
	,MAINTENANCEWORKORDER
	,MOVEORDER
	,PURCHASEORDER
	,WORKORDER
	,USERDEFINED
	,NOTDEFINED);

/** IfcProjectedOrTrueLengthEnum */
export type IfcProjectedOrTrueLengthEnum = ENUMERATION OF
	(PROJECTED_LENGTH
	,TRUE_LENGTH);

/** IfcProjectionElementTypeEnum */
export type IfcProjectionElementTypeEnum = ENUMERATION OF
	(BLISTER
	,DEVIATOR
	,USERDEFINED
	,NOTDEFINED);

/** IfcPropertySetTemplateTypeEnum */
export type IfcPropertySetTemplateTypeEnum = ENUMERATION OF
	(PSET_MATERIALDRIVEN
	,PSET_OCCURRENCEDRIVEN
	,PSET_PERFORMANCEDRIVEN
	,PSET_PROFILEDRIVEN
	,PSET_TYPEDRIVENONLY
	,PSET_TYPEDRIVENOVERRIDE
	,QTO_OCCURRENCEDRIVEN
	,QTO_TYPEDRIVENONLY
	,QTO_TYPEDRIVENOVERRIDE
	,NOTDEFINED);

/** IfcProtectiveDeviceTrippingUnitTypeEnum */
export type IfcProtectiveDeviceTrippingUnitTypeEnum = ENUMERATION OF
	(ELECTROMAGNETIC
	,ELECTRONIC
	,RESIDUALCURRENT
	,THERMAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcProtectiveDeviceTypeEnum */
export type IfcProtectiveDeviceTypeEnum = ENUMERATION OF
	(ANTI_ARCING_DEVICE
	,CIRCUITBREAKER
	,EARTHINGSWITCH
	,EARTHLEAKAGECIRCUITBREAKER
	,FUSEDISCONNECTOR
	,RESIDUALCURRENTCIRCUITBREAKER
	,RESIDUALCURRENTSWITCH
	,SPARKGAP
	,VARISTOR
	,VOLTAGELIMITER
	,USERDEFINED
	,NOTDEFINED);

/** IfcPumpTypeEnum */
export type IfcPumpTypeEnum = ENUMERATION OF
	(CIRCULATOR
	,ENDSUCTION
	,SPLITCASE
	,SUBMERSIBLEPUMP
	,SUMPPUMP
	,VERTICALINLINE
	,VERTICALTURBINE
	,USERDEFINED
	,NOTDEFINED);

/** IfcRailTypeEnum */
export type IfcRailTypeEnum = ENUMERATION OF
	(BLADE
	,CHECKRAIL
	,GUARDRAIL
	,RACKRAIL
	,RAIL
	,STOCKRAIL
	,USERDEFINED
	,NOTDEFINED);

/** IfcRailingTypeEnum */
export type IfcRailingTypeEnum = ENUMERATION OF
	(BALUSTRADE
	,FENCE
	,GUARDRAIL
	,HANDRAIL
	,USERDEFINED
	,NOTDEFINED);

/** IfcRailwayPartTypeEnum */
export type IfcRailwayPartTypeEnum = ENUMERATION OF
	(ABOVETRACK
	,DILATIONTRACK
	,LINESIDE
	,LINESIDEPART
	,PLAINTRACK
	,SUBSTRUCTURE
	,TRACK
	,TRACKPART
	,TURNOUTTRACK
	,USERDEFINED
	,NOTDEFINED);

/** IfcRailwayTypeEnum */
export type IfcRailwayTypeEnum = ENUMERATION OF
	(USERDEFINED
	,NOTDEFINED);

/** IfcRampFlightTypeEnum */
export type IfcRampFlightTypeEnum = ENUMERATION OF
	(SPIRAL
	,STRAIGHT
	,USERDEFINED
	,NOTDEFINED);

/** IfcRampTypeEnum */
export type IfcRampTypeEnum = ENUMERATION OF
	(HALF_TURN_RAMP
	,QUARTER_TURN_RAMP
	,SPIRAL_RAMP
	,STRAIGHT_RUN_RAMP
	,TWO_QUARTER_TURN_RAMP
	,TWO_STRAIGHT_RUN_RAMP
	,USERDEFINED
	,NOTDEFINED);

/** IfcRecurrenceTypeEnum */
export type IfcRecurrenceTypeEnum = ENUMERATION OF
	(BY_DAY_COUNT
	,BY_WEEKDAY_COUNT
	,DAILY
	,MONTHLY_BY_DAY_OF_MONTH
	,MONTHLY_BY_POSITION
	,WEEKLY
	,YEARLY_BY_DAY_OF_MONTH
	,YEARLY_BY_POSITION);

/** IfcReferentTypeEnum */
export type IfcReferentTypeEnum = ENUMERATION OF
	(BOUNDARY
	,INTERSECTION
	,KILOPOINT
	,LANDMARK
	,MILEPOINT
	,POSITION
	,REFERENCEMARKER
	,STATION
	,SUPERELEVATIONEVENT
	,WIDTHEVENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcReflectanceMethodEnum */
export type IfcReflectanceMethodEnum = ENUMERATION OF
	(BLINN
	,FLAT
	,GLASS
	,MATT
	,METAL
	,MIRROR
	,PHONG
	,PHYSICAL
	,PLASTIC
	,STRAUSS
	,NOTDEFINED);

/** IfcReinforcedSoilTypeEnum */
export type IfcReinforcedSoilTypeEnum = ENUMERATION OF
	(DYNAMICALLYCOMPACTED
	,GROUTED
	,REPLACED
	,ROLLERCOMPACTED
	,SURCHARGEPRELOADED
	,VERTICALLYDRAINED
	,USERDEFINED
	,NOTDEFINED);

/** IfcReinforcingBarRoleEnum */
export type IfcReinforcingBarRoleEnum = ENUMERATION OF
	(ANCHORING
	,EDGE
	,LIGATURE
	,MAIN
	,PUNCHING
	,RING
	,SHEAR
	,STUD
	,USERDEFINED
	,NOTDEFINED);

/** IfcReinforcingBarSurfaceEnum */
export type IfcReinforcingBarSurfaceEnum = ENUMERATION OF
	(PLAIN
	,TEXTURED);

/** IfcReinforcingBarTypeEnum */
export type IfcReinforcingBarTypeEnum = ENUMERATION OF
	(ANCHORING
	,EDGE
	,LIGATURE
	,MAIN
	,PUNCHING
	,RING
	,SHEAR
	,SPACEBAR
	,STUD
	,USERDEFINED
	,NOTDEFINED);

/** IfcReinforcingMeshTypeEnum */
export type IfcReinforcingMeshTypeEnum = ENUMERATION OF
	(USERDEFINED
	,NOTDEFINED);

/** IfcRoadPartTypeEnum */
export type IfcRoadPartTypeEnum = ENUMERATION OF
	(BICYCLECROSSING
	,BUS_STOP
	,CARRIAGEWAY
	,CENTRALISLAND
	,CENTRALRESERVE
	,HARDSHOULDER
	,INTERSECTION
	,LAYBY
	,PARKINGBAY
	,PASSINGBAY
	,PEDESTRIAN_CROSSING
	,RAILWAYCROSSING
	,REFUGEISLAND
	,ROADSEGMENT
	,ROADSIDE
	,ROADSIDEPART
	,ROADWAYPLATEAU
	,ROUNDABOUT
	,SHOULDER
	,SIDEWALK
	,SOFTSHOULDER
	,TOLLPLAZA
	,TRAFFICISLAND
	,TRAFFICLANE
	,USERDEFINED
	,NOTDEFINED);

/** IfcRoadTypeEnum */
export type IfcRoadTypeEnum = ENUMERATION OF
	(USERDEFINED
	,NOTDEFINED);

/** IfcRoleEnum */
export type IfcRoleEnum = ENUMERATION OF
	(ARCHITECT
	,BUILDINGOPERATOR
	,BUILDINGOWNER
	,CIVILENGINEER
	,CLIENT
	,COMMISSIONINGENGINEER
	,CONSTRUCTIONMANAGER
	,CONSULTANT
	,CONTRACTOR
	,COSTENGINEER
	,ELECTRICALENGINEER
	,ENGINEER
	,FACILITIESMANAGER
	,FIELDCONSTRUCTIONMANAGER
	,MANUFACTURER
	,MECHANICALENGINEER
	,OWNER
	,PROJECTMANAGER
	,RESELLER
	,STRUCTURALENGINEER
	,SUBCONTRACTOR
	,SUPPLIER
	,USERDEFINED);

/** IfcRoofTypeEnum */
export type IfcRoofTypeEnum = ENUMERATION OF
	(BARREL_ROOF
	,BUTTERFLY_ROOF
	,DOME_ROOF
	,FLAT_ROOF
	,FREEFORM
	,GABLE_ROOF
	,GAMBREL_ROOF
	,HIPPED_GABLE_ROOF
	,HIP_ROOF
	,MANSARD_ROOF
	,PAVILION_ROOF
	,RAINBOW_ROOF
	,SHED_ROOF
	,USERDEFINED
	,NOTDEFINED);

/** IfcSIPrefix */
export type IfcSIPrefix = ENUMERATION OF
	(ATTO
	,CENTI
	,DECA
	,DECI
	,EXA
	,FEMTO
	,GIGA
	,HECTO
	,KILO
	,MEGA
	,MICRO
	,MILLI
	,NANO
	,PETA
	,PICO
	,TERA);

/** IfcSIUnitName */
export type IfcSIUnitName = ENUMERATION OF
	(AMPERE
	,BECQUEREL
	,CANDELA
	,COULOMB
	,CUBIC_METRE
	,DEGREE_CELSIUS
	,FARAD
	,GRAM
	,GRAY
	,HENRY
	,HERTZ
	,JOULE
	,KELVIN
	,LUMEN
	,LUX
	,METRE
	,MOLE
	,NEWTON
	,OHM
	,PASCAL
	,RADIAN
	,SECOND
	,SIEMENS
	,SIEVERT
	,SQUARE_METRE
	,STERADIAN
	,TESLA
	,VOLT
	,WATT
	,WEBER);

/** IfcSanitaryTerminalTypeEnum */
export type IfcSanitaryTerminalTypeEnum = ENUMERATION OF
	(BATH
	,BIDET
	,CISTERN
	,SANITARYFOUNTAIN
	,SHOWER
	,SINK
	,TOILETPAN
	,URINAL
	,WASHHANDBASIN
	,WCSEAT
	,USERDEFINED
	,NOTDEFINED);

/** IfcSectionTypeEnum */
export type IfcSectionTypeEnum = ENUMERATION OF
	(TAPERED
	,UNIFORM);

/** IfcSensorTypeEnum */
export type IfcSensorTypeEnum = ENUMERATION OF
	(CO2SENSOR
	,CONDUCTANCESENSOR
	,CONTACTSENSOR
	,COSENSOR
	,EARTHQUAKESENSOR
	,FIRESENSOR
	,FLOWSENSOR
	,FOREIGNOBJECTDETECTIONSENSOR
	,FROSTSENSOR
	,GASSENSOR
	,HEATSENSOR
	,HUMIDITYSENSOR
	,IDENTIFIERSENSOR
	,IONCONCENTRATIONSENSOR
	,LEVELSENSOR
	,LIGHTSENSOR
	,MOISTURESENSOR
	,MOVEMENTSENSOR
	,OBSTACLESENSOR
	,PHSENSOR
	,PRESSURESENSOR
	,RADIATIONSENSOR
	,RADIOACTIVITYSENSOR
	,RAINSENSOR
	,SMOKESENSOR
	,SNOWDEPTHSENSOR
	,SOUNDSENSOR
	,TEMPERATURESENSOR
	,TRAINSENSOR
	,TURNOUTCLOSURESENSOR
	,WHEELSENSOR
	,WINDSENSOR
	,USERDEFINED
	,NOTDEFINED);

/** IfcSequenceEnum */
export type IfcSequenceEnum = ENUMERATION OF
	(FINISH_FINISH
	,FINISH_START
	,START_FINISH
	,START_START
	,USERDEFINED
	,NOTDEFINED);

/** IfcShadingDeviceTypeEnum */
export type IfcShadingDeviceTypeEnum = ENUMERATION OF
	(AWNING
	,JALOUSIE
	,SHUTTER
	,USERDEFINED
	,NOTDEFINED);

/** IfcSignTypeEnum */
export type IfcSignTypeEnum = ENUMERATION OF
	(MARKER
	,MIRROR
	,PICTORAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcSignalTypeEnum */
export type IfcSignalTypeEnum = ENUMERATION OF
	(AUDIO
	,MIXED
	,VISUAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcSimplePropertyTemplateTypeEnum */
export type IfcSimplePropertyTemplateTypeEnum = ENUMERATION OF
	(P_BOUNDEDVALUE
	,P_ENUMERATEDVALUE
	,P_LISTVALUE
	,P_REFERENCEVALUE
	,P_SINGLEVALUE
	,P_TABLEVALUE
	,Q_AREA
	,Q_COUNT
	,Q_LENGTH
	,Q_NUMBER
	,Q_TIME
	,Q_VOLUME
	,Q_WEIGHT);

/** IfcSlabTypeEnum */
export type IfcSlabTypeEnum = ENUMERATION OF
	(APPROACH_SLAB
	,BASESLAB
	,FLOOR
	,LANDING
	,PAVING
	,ROOF
	,SIDEWALK
	,TRACKSLAB
	,WEARING
	,USERDEFINED
	,NOTDEFINED);

/** IfcSolarDeviceTypeEnum */
export type IfcSolarDeviceTypeEnum = ENUMERATION OF
	(SOLARCOLLECTOR
	,SOLARPANEL
	,USERDEFINED
	,NOTDEFINED);

/** IfcSpaceHeaterTypeEnum */
export type IfcSpaceHeaterTypeEnum = ENUMERATION OF
	(CONVECTOR
	,RADIATOR
	,USERDEFINED
	,NOTDEFINED);

/** IfcSpaceTypeEnum */
export type IfcSpaceTypeEnum = ENUMERATION OF
	(BERTH
	,EXTERNAL
	,GFA
	,INTERNAL
	,PARKING
	,SPACE
	,USERDEFINED
	,NOTDEFINED);

/** IfcSpatialZoneTypeEnum */
export type IfcSpatialZoneTypeEnum = ENUMERATION OF
	(CONSTRUCTION
	,FIRESAFETY
	,INTERFERENCE
	,LIGHTING
	,OCCUPANCY
	,RESERVATION
	,SECURITY
	,THERMAL
	,TRANSPORT
	,VENTILATION
	,USERDEFINED
	,NOTDEFINED);

/** IfcStackTerminalTypeEnum */
export type IfcStackTerminalTypeEnum = ENUMERATION OF
	(BIRDCAGE
	,COWL
	,RAINWATERHOPPER
	,USERDEFINED
	,NOTDEFINED);

/** IfcStairFlightTypeEnum */
export type IfcStairFlightTypeEnum = ENUMERATION OF
	(CURVED
	,FREEFORM
	,SPIRAL
	,STRAIGHT
	,WINDER
	,USERDEFINED
	,NOTDEFINED);

/** IfcStairTypeEnum */
export type IfcStairTypeEnum = ENUMERATION OF
	(CURVED_RUN_STAIR
	,DOUBLE_RETURN_STAIR
	,HALF_TURN_STAIR
	,HALF_WINDING_STAIR
	,LADDER
	,QUARTER_TURN_STAIR
	,QUARTER_WINDING_STAIR
	,SPIRAL_STAIR
	,STRAIGHT_RUN_STAIR
	,THREE_QUARTER_TURN_STAIR
	,THREE_QUARTER_WINDING_STAIR
	,TWO_CURVED_RUN_STAIR
	,TWO_QUARTER_TURN_STAIR
	,TWO_QUARTER_WINDING_STAIR
	,TWO_STRAIGHT_RUN_STAIR
	,USERDEFINED
	,NOTDEFINED);

/** IfcStateEnum */
export type IfcStateEnum = ENUMERATION OF
	(LOCKED
	,READONLY
	,READONLYLOCKED
	,READWRITE
	,READWRITELOCKED);

/** IfcStructuralCurveActivityTypeEnum */
export type IfcStructuralCurveActivityTypeEnum = ENUMERATION OF
	(CONST
	,DISCRETE
	,EQUIDISTANT
	,LINEAR
	,PARABOLA
	,POLYGONAL
	,SINUS
	,USERDEFINED
	,NOTDEFINED);

/** IfcStructuralCurveMemberTypeEnum */
export type IfcStructuralCurveMemberTypeEnum = ENUMERATION OF
	(CABLE
	,COMPRESSION_MEMBER
	,PIN_JOINED_MEMBER
	,RIGID_JOINED_MEMBER
	,TENSION_MEMBER
	,USERDEFINED
	,NOTDEFINED);

/** IfcStructuralSurfaceActivityTypeEnum */
export type IfcStructuralSurfaceActivityTypeEnum = ENUMERATION OF
	(BILINEAR
	,CONST
	,DISCRETE
	,ISOCONTOUR
	,USERDEFINED
	,NOTDEFINED);

/** IfcStructuralSurfaceMemberTypeEnum */
export type IfcStructuralSurfaceMemberTypeEnum = ENUMERATION OF
	(BENDING_ELEMENT
	,MEMBRANE_ELEMENT
	,SHELL
	,USERDEFINED
	,NOTDEFINED);

/** IfcSubContractResourceTypeEnum */
export type IfcSubContractResourceTypeEnum = ENUMERATION OF
	(PURCHASE
	,WORK
	,USERDEFINED
	,NOTDEFINED);

/** IfcSurfaceFeatureTypeEnum */
export type IfcSurfaceFeatureTypeEnum = ENUMERATION OF
	(DEFECT
	,HATCHMARKING
	,LINEMARKING
	,MARK
	,NONSKIDSURFACING
	,PAVEMENTSURFACEMARKING
	,RUMBLESTRIP
	,SYMBOLMARKING
	,TAG
	,TRANSVERSERUMBLESTRIP
	,TREATMENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcSurfaceSide */
export type IfcSurfaceSide = ENUMERATION OF
	(BOTH
	,NEGATIVE
	,POSITIVE);

/** IfcSwitchingDeviceTypeEnum */
export type IfcSwitchingDeviceTypeEnum = ENUMERATION OF
	(CONTACTOR
	,DIMMERSWITCH
	,EMERGENCYSTOP
	,KEYPAD
	,MOMENTARYSWITCH
	,RELAY
	,SELECTORSWITCH
	,STARTER
	,START_AND_STOP_EQUIPMENT
	,SWITCHDISCONNECTOR
	,TOGGLESWITCH
	,USERDEFINED
	,NOTDEFINED);

/** IfcSystemFurnitureElementTypeEnum */
export type IfcSystemFurnitureElementTypeEnum = ENUMERATION OF
	(PANEL
	,SUBRACK
	,WORKSURFACE
	,USERDEFINED
	,NOTDEFINED);

/** IfcTankTypeEnum */
export type IfcTankTypeEnum = ENUMERATION OF
	(BASIN
	,BREAKPRESSURE
	,EXPANSION
	,FEEDANDEXPANSION
	,OILRETENTIONTRAY
	,PRESSUREVESSEL
	,STORAGE
	,VESSEL
	,USERDEFINED
	,NOTDEFINED);

/** IfcTaskDurationEnum */
export type IfcTaskDurationEnum = ENUMERATION OF
	(ELAPSEDTIME
	,WORKTIME
	,NOTDEFINED);

/** IfcTaskTypeEnum */
export type IfcTaskTypeEnum = ENUMERATION OF
	(ADJUSTMENT
	,ATTENDANCE
	,CALIBRATION
	,CONSTRUCTION
	,DEMOLITION
	,DISMANTLE
	,DISPOSAL
	,EMERGENCY
	,INSPECTION
	,INSTALLATION
	,LOGISTIC
	,MAINTENANCE
	,MOVE
	,OPERATION
	,REMOVAL
	,RENOVATION
	,SAFETY
	,SHUTDOWN
	,STARTUP
	,TESTING
	,TROUBLESHOOTING
	,USERDEFINED
	,NOTDEFINED);

/** IfcTendonAnchorTypeEnum */
export type IfcTendonAnchorTypeEnum = ENUMERATION OF
	(COUPLER
	,FIXED_END
	,TENSIONING_END
	,USERDEFINED
	,NOTDEFINED);

/** IfcTendonConduitTypeEnum */
export type IfcTendonConduitTypeEnum = ENUMERATION OF
	(COUPLER
	,DIABOLO
	,DUCT
	,GROUTING_DUCT
	,TRUMPET
	,USERDEFINED
	,NOTDEFINED);

/** IfcTendonTypeEnum */
export type IfcTendonTypeEnum = ENUMERATION OF
	(BAR
	,COATED
	,STRAND
	,WIRE
	,USERDEFINED
	,NOTDEFINED);

/** IfcTextPath */
export type IfcTextPath = ENUMERATION OF
	(DOWN
	,LEFT
	,RIGHT
	,UP);

/** IfcTimeSeriesDataTypeEnum */
export type IfcTimeSeriesDataTypeEnum = ENUMERATION OF
	(CONTINUOUS
	,DISCRETE
	,DISCRETEBINARY
	,PIECEWISEBINARY
	,PIECEWISECONSTANT
	,PIECEWISECONTINUOUS
	,NOTDEFINED);

/** IfcTrackElementTypeEnum */
export type IfcTrackElementTypeEnum = ENUMERATION OF
	(BLOCKINGDEVICE
	,DERAILER
	,FROG
	,HALF_SET_OF_BLADES
	,SLEEPER
	,SPEEDREGULATOR
	,TRACKENDOFALIGNMENT
	,VEHICLESTOP
	,USERDEFINED
	,NOTDEFINED);

/** IfcTransformerTypeEnum */
export type IfcTransformerTypeEnum = ENUMERATION OF
	(CHOPPER
	,COMBINED
	,CURRENT
	,FREQUENCY
	,INVERTER
	,RECTIFIER
	,VOLTAGE
	,USERDEFINED
	,NOTDEFINED);

/** IfcTransitionCode */
export type IfcTransitionCode = ENUMERATION OF
	(CONTINUOUS
	,CONTSAMEGRADIENT
	,CONTSAMEGRADIENTSAMECURVATURE
	,DISCONTINUOUS);

/** IfcTransportElementTypeEnum */
export type IfcTransportElementTypeEnum = ENUMERATION OF
	(CRANEWAY
	,ELEVATOR
	,ESCALATOR
	,HAULINGGEAR
	,LIFTINGGEAR
	,MOVINGWALKWAY
	,USERDEFINED
	,NOTDEFINED);

/** IfcTrimmingPreference */
export type IfcTrimmingPreference = ENUMERATION OF
	(CARTESIAN
	,PARAMETER
	,UNSPECIFIED);

/** IfcTubeBundleTypeEnum */
export type IfcTubeBundleTypeEnum = ENUMERATION OF
	(FINNED
	,USERDEFINED
	,NOTDEFINED);

/** IfcUnitEnum */
export type IfcUnitEnum = ENUMERATION OF
	(ABSORBEDDOSEUNIT
	,AMOUNTOFSUBSTANCEUNIT
	,AREAUNIT
	,DOSEEQUIVALENTUNIT
	,ELECTRICCAPACITANCEUNIT
	,ELECTRICCHARGEUNIT
	,ELECTRICCONDUCTANCEUNIT
	,ELECTRICCURRENTUNIT
	,ELECTRICRESISTANCEUNIT
	,ELECTRICVOLTAGEUNIT
	,ENERGYUNIT
	,FORCEUNIT
	,FREQUENCYUNIT
	,ILLUMINANCEUNIT
	,INDUCTANCEUNIT
	,LENGTHUNIT
	,LUMINOUSFLUXUNIT
	,LUMINOUSINTENSITYUNIT
	,MAGNETICFLUXDENSITYUNIT
	,MAGNETICFLUXUNIT
	,MASSUNIT
	,PLANEANGLEUNIT
	,POWERUNIT
	,PRESSUREUNIT
	,RADIOACTIVITYUNIT
	,SOLIDANGLEUNIT
	,THERMODYNAMICTEMPERATUREUNIT
	,TIMEUNIT
	,VOLUMEUNIT
	,USERDEFINED);

/** IfcUnitaryControlElementTypeEnum */
export type IfcUnitaryControlElementTypeEnum = ENUMERATION OF
	(ALARMPANEL
	,BASESTATIONCONTROLLER
	,COMBINED
	,CONTROLPANEL
	,GASDETECTIONPANEL
	,HUMIDISTAT
	,INDICATORPANEL
	,MIMICPANEL
	,THERMOSTAT
	,WEATHERSTATION
	,USERDEFINED
	,NOTDEFINED);

/** IfcUnitaryEquipmentTypeEnum */
export type IfcUnitaryEquipmentTypeEnum = ENUMERATION OF
	(AIRCONDITIONINGUNIT
	,AIRHANDLER
	,DEHUMIDIFIER
	,ROOFTOPUNIT
	,SPLITSYSTEM
	,USERDEFINED
	,NOTDEFINED);

/** IfcValveTypeEnum */
export type IfcValveTypeEnum = ENUMERATION OF
	(AIRRELEASE
	,ANTIVACUUM
	,CHANGEOVER
	,CHECK
	,COMMISSIONING
	,DIVERTING
	,DOUBLECHECK
	,DOUBLEREGULATING
	,DRAWOFFCOCK
	,FAUCET
	,FLUSHING
	,GASCOCK
	,GASTAP
	,ISOLATING
	,MIXING
	,PRESSUREREDUCING
	,PRESSURERELIEF
	,REGULATING
	,SAFETYCUTOFF
	,STEAMTRAP
	,STOPCOCK
	,USERDEFINED
	,NOTDEFINED);

/** IfcVehicleTypeEnum */
export type IfcVehicleTypeEnum = ENUMERATION OF
	(CARGO
	,ROLLINGSTOCK
	,VEHICLE
	,VEHICLEAIR
	,VEHICLEMARINE
	,VEHICLETRACKED
	,VEHICLEWHEELED
	,USERDEFINED
	,NOTDEFINED);

/** IfcVibrationDamperTypeEnum */
export type IfcVibrationDamperTypeEnum = ENUMERATION OF
	(AXIAL_YIELD
	,BENDING_YIELD
	,FRICTION
	,RUBBER
	,SHEAR_YIELD
	,VISCOUS
	,USERDEFINED
	,NOTDEFINED);

/** IfcVibrationIsolatorTypeEnum */
export type IfcVibrationIsolatorTypeEnum = ENUMERATION OF
	(BASE
	,COMPRESSION
	,SPRING
	,USERDEFINED
	,NOTDEFINED);

/** IfcVirtualElementTypeEnum */
export type IfcVirtualElementTypeEnum = ENUMERATION OF
	(BOUNDARY
	,CLEARANCE
	,PROVISIONFORVOID
	,USERDEFINED
	,NOTDEFINED);

/** IfcVoidingFeatureTypeEnum */
export type IfcVoidingFeatureTypeEnum = ENUMERATION OF
	(CHAMFER
	,CUTOUT
	,EDGE
	,HOLE
	,MITER
	,NOTCH
	,USERDEFINED
	,NOTDEFINED);

/** IfcWallTypeEnum */
export type IfcWallTypeEnum = ENUMERATION OF
	(ELEMENTEDWALL
	,MOVABLE
	,PARAPET
	,PARTITIONING
	,PLUMBINGWALL
	,POLYGONAL
	,RETAININGWALL
	,SHEAR
	,SOLIDWALL
	,STANDARD
	,WAVEWALL
	,USERDEFINED
	,NOTDEFINED);

/** IfcWasteTerminalTypeEnum */
export type IfcWasteTerminalTypeEnum = ENUMERATION OF
	(FLOORTRAP
	,FLOORWASTE
	,GULLYSUMP
	,GULLYTRAP
	,ROOFDRAIN
	,WASTEDISPOSALUNIT
	,WASTETRAP
	,USERDEFINED
	,NOTDEFINED);

/** IfcWindowPanelOperationEnum */
export type IfcWindowPanelOperationEnum = ENUMERATION OF
	(BOTTOMHUNG
	,FIXEDCASEMENT
	,OTHEROPERATION
	,PIVOTHORIZONTAL
	,PIVOTVERTICAL
	,REMOVABLECASEMENT
	,SIDEHUNGLEFTHAND
	,SIDEHUNGRIGHTHAND
	,SLIDINGHORIZONTAL
	,SLIDINGVERTICAL
	,TILTANDTURNLEFTHAND
	,TILTANDTURNRIGHTHAND
	,TOPHUNG
	,NOTDEFINED);

/** IfcWindowPanelPositionEnum */
export type IfcWindowPanelPositionEnum = ENUMERATION OF
	(BOTTOM
	,LEFT
	,MIDDLE
	,RIGHT
	,TOP
	,NOTDEFINED);

/** IfcWindowTypeEnum */
export type IfcWindowTypeEnum = ENUMERATION OF
	(LIGHTDOME
	,SKYLIGHT
	,WINDOW
	,USERDEFINED
	,NOTDEFINED);

/** IfcWindowTypePartitioningEnum */
export type IfcWindowTypePartitioningEnum = ENUMERATION OF
	(DOUBLE_PANEL_HORIZONTAL
	,DOUBLE_PANEL_VERTICAL
	,SINGLE_PANEL
	,TRIPLE_PANEL_BOTTOM
	,TRIPLE_PANEL_HORIZONTAL
	,TRIPLE_PANEL_LEFT
	,TRIPLE_PANEL_RIGHT
	,TRIPLE_PANEL_TOP
	,TRIPLE_PANEL_VERTICAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcWorkCalendarTypeEnum */
export type IfcWorkCalendarTypeEnum = ENUMERATION OF
	(FIRSTSHIFT
	,SECONDSHIFT
	,THIRDSHIFT
	,USERDEFINED
	,NOTDEFINED);

/** IfcWorkPlanTypeEnum */
export type IfcWorkPlanTypeEnum = ENUMERATION OF
	(ACTUAL
	,BASELINE
	,PLANNED
	,USERDEFINED
	,NOTDEFINED);

/** IfcWorkScheduleTypeEnum */
export type IfcWorkScheduleTypeEnum = ENUMERATION OF
	(ACTUAL
	,BASELINE
	,PLANNED
	,USERDEFINED
	,NOTDEFINED);

/** IfcActorSelect */
export type IfcActorSelect = SELECT
	(IfcOrganization
	,IfcPerson
	,IfcPersonAndOrganization);

/** IfcAppliedValueSelect */
export type IfcAppliedValueSelect = SELECT
	(IfcMeasureWithUnit
	,IfcReference
	,IfcValue);

/** IfcAxis2Placement */
export type IfcAxis2Placement = SELECT
	(IfcAxis2Placement2D
	,IfcAxis2Placement3D);

/** IfcBendingParameterSelect */
export type IfcBendingParameterSelect = SELECT
	(IfcLengthMeasure
	,IfcPlaneAngleMeasure);

/** IfcBooleanOperand */
export type IfcBooleanOperand = SELECT
	(IfcBooleanResult
	,IfcCsgPrimitive3D
	,IfcHalfSpaceSolid
	,IfcSolidModel
	,IfcTessellatedFaceSet);

/** IfcClassificationReferenceSelect */
export type IfcClassificationReferenceSelect = SELECT
	(IfcClassification
	,IfcClassificationReference);

/** IfcClassificationSelect */
export type IfcClassificationSelect = SELECT
	(IfcClassification
	,IfcClassificationReference);

/** IfcColour */
export type IfcColour = SELECT
	(IfcColourSpecification
	,IfcPreDefinedColour);

/** IfcColourOrFactor */
export type IfcColourOrFactor = SELECT
	(IfcColourRgb
	,IfcNormalisedRatioMeasure);

/** IfcCoordinateReferenceSystemSelect */
export type IfcCoordinateReferenceSystemSelect = SELECT
	(IfcCoordinateReferenceSystem
	,IfcGeometricRepresentationContext);

/** IfcCsgSelect */
export type IfcCsgSelect = SELECT
	(IfcBooleanResult
	,IfcCsgPrimitive3D);

/** IfcCurveFontOrScaledCurveFontSelect */
export type IfcCurveFontOrScaledCurveFontSelect = SELECT
	(IfcCurveStyleFontAndScaling
	,IfcCurveStyleFontSelect);

/** IfcCurveMeasureSelect */
export type IfcCurveMeasureSelect = SELECT
	(IfcLengthMeasure
	,IfcParameterValue);

/** IfcCurveOnSurface */
export type IfcCurveOnSurface = SELECT
	(IfcCompositeCurveOnSurface
	,IfcPcurve
	,IfcSurfaceCurve);

/** IfcCurveOrEdgeCurve */
export type IfcCurveOrEdgeCurve = SELECT
	(IfcBoundedCurve
	,IfcEdgeCurve);

/** IfcCurveStyleFontSelect */
export type IfcCurveStyleFontSelect = SELECT
	(IfcCurveStyleFont
	,IfcPreDefinedCurveFont);

/** IfcDefinitionSelect */
export type IfcDefinitionSelect = SELECT
	(IfcObjectDefinition
	,IfcPropertyDefinition);

/** IfcDerivedMeasureValue */
export type IfcDerivedMeasureValue = SELECT
	(IfcAbsorbedDoseMeasure
	,IfcAccelerationMeasure
	,IfcAngularVelocityMeasure
	,IfcAreaDensityMeasure
	,IfcCompoundPlaneAngleMeasure
	,IfcCurvatureMeasure
	,IfcDoseEquivalentMeasure
	,IfcDynamicViscosityMeasure
	,IfcElectricCapacitanceMeasure
	,IfcElectricChargeMeasure
	,IfcElectricConductanceMeasure
	,IfcElectricResistanceMeasure
	,IfcElectricVoltageMeasure
	,IfcEnergyMeasure
	,IfcForceMeasure
	,IfcFrequencyMeasure
	,IfcHeatFluxDensityMeasure
	,IfcHeatingValueMeasure
	,IfcIlluminanceMeasure
	,IfcInductanceMeasure
	,IfcIntegerCountRateMeasure
	,IfcIonConcentrationMeasure
	,IfcIsothermalMoistureCapacityMeasure
	,IfcKinematicViscosityMeasure
	,IfcLinearForceMeasure
	,IfcLinearMomentMeasure
	,IfcLinearStiffnessMeasure
	,IfcLinearVelocityMeasure
	,IfcLuminousFluxMeasure
	,IfcLuminousIntensityDistributionMeasure
	,IfcMagneticFluxDensityMeasure
	,IfcMagneticFluxMeasure
	,IfcMassDensityMeasure
	,IfcMassFlowRateMeasure
	,IfcMassPerLengthMeasure
	,IfcModulusOfElasticityMeasure
	,IfcModulusOfLinearSubgradeReactionMeasure
	,IfcModulusOfRotationalSubgradeReactionMeasure
	,IfcModulusOfSubgradeReactionMeasure
	,IfcMoistureDiffusivityMeasure
	,IfcMolecularWeightMeasure
	,IfcMomentOfInertiaMeasure
	,IfcMonetaryMeasure
	,IfcPHMeasure
	,IfcPlanarForceMeasure
	,IfcPowerMeasure
	,IfcPressureMeasure
	,IfcRadioActivityMeasure
	,IfcRotationalFrequencyMeasure
	,IfcRotationalMassMeasure
	,IfcRotationalStiffnessMeasure
	,IfcSectionModulusMeasure
	,IfcSectionalAreaIntegralMeasure
	,IfcShearModulusMeasure
	,IfcSoundPowerLevelMeasure
	,IfcSoundPowerMeasure
	,IfcSoundPressureLevelMeasure
	,IfcSoundPressureMeasure
	,IfcSpecificHeatCapacityMeasure
	,IfcTemperatureGradientMeasure
	,IfcTemperatureRateOfChangeMeasure
	,IfcThermalAdmittanceMeasure
	,IfcThermalConductivityMeasure
	,IfcThermalExpansionCoefficientMeasure
	,IfcThermalResistanceMeasure
	,IfcThermalTransmittanceMeasure
	,IfcTorqueMeasure
	,IfcVaporPermeabilityMeasure
	,IfcVolumetricFlowRateMeasure
	,IfcWarpingConstantMeasure
	,IfcWarpingMomentMeasure);

/** IfcDocumentSelect */
export type IfcDocumentSelect = SELECT
	(IfcDocumentInformation
	,IfcDocumentReference);

/** IfcFillStyleSelect */
export type IfcFillStyleSelect = SELECT
	(IfcColour
	,IfcExternallyDefinedHatchStyle
	,IfcFillAreaStyleHatching
	,IfcFillAreaStyleTiles);

/** IfcGeometricSetSelect */
export type IfcGeometricSetSelect = SELECT
	(IfcCurve
	,IfcPoint
	,IfcSurface);

/** IfcGridPlacementDirectionSelect */
export type IfcGridPlacementDirectionSelect = SELECT
	(IfcDirection
	,IfcVirtualGridIntersection);

/** IfcHatchLineDistanceSelect */
export type IfcHatchLineDistanceSelect = SELECT
	(IfcPositiveLengthMeasure
	,IfcVector);

/** IfcInterferenceSelect */
export type IfcInterferenceSelect = SELECT
	(IfcElement
	,IfcSpatialElement);

/** IfcLayeredItem */
export type IfcLayeredItem = SELECT
	(IfcRepresentation
	,IfcRepresentationItem);

/** IfcLibrarySelect */
export type IfcLibrarySelect = SELECT
	(IfcLibraryInformation
	,IfcLibraryReference);

/** IfcLightDistributionDataSourceSelect */
export type IfcLightDistributionDataSourceSelect = SELECT
	(IfcExternalReference
	,IfcLightIntensityDistribution);

/** IfcMaterialSelect */
export type IfcMaterialSelect = SELECT
	(IfcMaterialDefinition
	,IfcMaterialList
	,IfcMaterialUsageDefinition);

/** IfcMeasureValue */
export type IfcMeasureValue = SELECT
	(IfcAmountOfSubstanceMeasure
	,IfcAreaMeasure
	,IfcComplexNumber
	,IfcContextDependentMeasure
	,IfcCountMeasure
	,IfcDescriptiveMeasure
	,IfcElectricCurrentMeasure
	,IfcLengthMeasure
	,IfcLuminousIntensityMeasure
	,IfcMassMeasure
	,IfcNonNegativeLengthMeasure
	,IfcNormalisedRatioMeasure
	,IfcNumericMeasure
	,IfcParameterValue
	,IfcPlaneAngleMeasure
	,IfcPositiveLengthMeasure
	,IfcPositivePlaneAngleMeasure
	,IfcPositiveRatioMeasure
	,IfcRatioMeasure
	,IfcSolidAngleMeasure
	,IfcThermodynamicTemperatureMeasure
	,IfcTimeMeasure
	,IfcVolumeMeasure);

/** IfcMetricValueSelect */
export type IfcMetricValueSelect = SELECT
	(IfcAppliedValue
	,IfcMeasureWithUnit
	,IfcReference
	,IfcTable
	,IfcTimeSeries
	,IfcValue);

/** IfcModulusOfRotationalSubgradeReactionSelect */
export type IfcModulusOfRotationalSubgradeReactionSelect = SELECT
	(IfcBoolean
	,IfcModulusOfRotationalSubgradeReactionMeasure);

/** IfcModulusOfSubgradeReactionSelect */
export type IfcModulusOfSubgradeReactionSelect = SELECT
	(IfcBoolean
	,IfcModulusOfSubgradeReactionMeasure);

/** IfcModulusOfTranslationalSubgradeReactionSelect */
export type IfcModulusOfTranslationalSubgradeReactionSelect = SELECT
	(IfcBoolean
	,IfcModulusOfLinearSubgradeReactionMeasure);

/** IfcObjectReferenceSelect */
export type IfcObjectReferenceSelect = SELECT
	(IfcAddress
	,IfcAppliedValue
	,IfcExternalReference
	,IfcMaterialDefinition
	,IfcOrganization
	,IfcPerson
	,IfcPersonAndOrganization
	,IfcTable
	,IfcTimeSeries);

/** IfcPointOrVertexPoint */
export type IfcPointOrVertexPoint = SELECT
	(IfcPoint
	,IfcVertexPoint);

/** IfcProcessSelect */
export type IfcProcessSelect = SELECT
	(IfcProcess
	,IfcTypeProcess);

/** IfcProductRepresentationSelect */
export type IfcProductRepresentationSelect = SELECT
	(IfcProductDefinitionShape
	,IfcRepresentationMap);

/** IfcProductSelect */
export type IfcProductSelect = SELECT
	(IfcProduct
	,IfcTypeProduct);

/** IfcPropertySetDefinitionSelect */
export type IfcPropertySetDefinitionSelect = SELECT
	(IfcPropertySetDefinition
	,IfcPropertySetDefinitionSet);

/** IfcResourceObjectSelect */
export type IfcResourceObjectSelect = SELECT
	(IfcActorRole
	,IfcAppliedValue
	,IfcApproval
	,IfcConstraint
	,IfcContextDependentUnit
	,IfcConversionBasedUnit
	,IfcExternalInformation
	,IfcExternalReference
	,IfcMaterialDefinition
	,IfcOrganization
	,IfcPerson
	,IfcPersonAndOrganization
	,IfcPhysicalQuantity
	,IfcProfileDef
	,IfcPropertyAbstraction
	,IfcShapeAspect
	,IfcTimeSeries);

/** IfcResourceSelect */
export type IfcResourceSelect = SELECT
	(IfcResource
	,IfcTypeResource);

/** IfcRotationalStiffnessSelect */
export type IfcRotationalStiffnessSelect = SELECT
	(IfcBoolean
	,IfcRotationalStiffnessMeasure);

/** IfcSegmentIndexSelect */
export type IfcSegmentIndexSelect = SELECT
	(IfcArcIndex
	,IfcLineIndex);

/** IfcShell */
export type IfcShell = SELECT
	(IfcClosedShell
	,IfcOpenShell);

/** IfcSimpleValue */
export type IfcSimpleValue = SELECT
	(IfcBinary
	,IfcBoolean
	,IfcDate
	,IfcDateTime
	,IfcDuration
	,IfcIdentifier
	,IfcInteger
	,IfcLabel
	,IfcLogical
	,IfcPositiveInteger
	,IfcReal
	,IfcText
	,IfcTime
	,IfcTimeStamp
	,IfcURIReference);

/** IfcSizeSelect */
export type IfcSizeSelect = SELECT
	(IfcDescriptiveMeasure
	,IfcLengthMeasure
	,IfcNormalisedRatioMeasure
	,IfcPositiveLengthMeasure
	,IfcPositiveRatioMeasure
	,IfcRatioMeasure);

/** IfcSolidOrShell */
export type IfcSolidOrShell = SELECT
	(IfcClosedShell
	,IfcSolidModel);

/** IfcSpaceBoundarySelect */
export type IfcSpaceBoundarySelect = SELECT
	(IfcExternalSpatialElement
	,IfcSpace);

/** IfcSpatialReferenceSelect */
export type IfcSpatialReferenceSelect = SELECT
	(IfcGroup
	,IfcProduct);

/** IfcSpecularHighlightSelect */
export type IfcSpecularHighlightSelect = SELECT
	(IfcSpecularExponent
	,IfcSpecularRoughness);

/** IfcStructuralActivityAssignmentSelect */
export type IfcStructuralActivityAssignmentSelect = SELECT
	(IfcElement
	,IfcStructuralItem);

/** IfcSurfaceOrFaceSurface */
export type IfcSurfaceOrFaceSurface = SELECT
	(IfcFaceBasedSurfaceModel
	,IfcFaceSurface
	,IfcSurface);

/** IfcSurfaceStyleElementSelect */
export type IfcSurfaceStyleElementSelect = SELECT
	(IfcExternallyDefinedSurfaceStyle
	,IfcSurfaceStyleLighting
	,IfcSurfaceStyleRefraction
	,IfcSurfaceStyleShading
	,IfcSurfaceStyleWithTextures);

/** IfcTextFontSelect */
export type IfcTextFontSelect = SELECT
	(IfcExternallyDefinedTextFont
	,IfcPreDefinedTextFont);

/** IfcTimeOrRatioSelect */
export type IfcTimeOrRatioSelect = SELECT
	(IfcDuration
	,IfcRatioMeasure);

/** IfcTranslationalStiffnessSelect */
export type IfcTranslationalStiffnessSelect = SELECT
	(IfcBoolean
	,IfcLinearStiffnessMeasure);

/** IfcTrimmingSelect */
export type IfcTrimmingSelect = SELECT
	(IfcCartesianPoint
	,IfcParameterValue);

/** IfcUnit */
export type IfcUnit = SELECT
	(IfcDerivedUnit
	,IfcMonetaryUnit
	,IfcNamedUnit);

/** IfcValue */
export type IfcValue = SELECT
	(IfcDerivedMeasureValue
	,IfcMeasureValue
	,IfcSimpleValue);

/** IfcVectorOrDirection */
export type IfcVectorOrDirection = SELECT
	(IfcDirection
	,IfcVector);

/** IfcWarpingStiffnessSelect */
export type IfcWarpingStiffnessSelect = SELECT
	(IfcBoolean
	,IfcWarpingMomentMeasure);

