/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC Type Aliases
 * Generated from EXPRESS schema: IFC4_ADD2_TC1
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
	(DEAD_LOAD_G
	,COMPLETION_G1
	,LIVE_LOAD_Q
	,SNOW_S
	,WIND_W
	,PRESTRESSING_P
	,SETTLEMENT_U
	,TEMPERATURE_T
	,EARTHQUAKE_E
	,FIRE
	,IMPULSE
	,IMPACT
	,TRANSPORT
	,ERECTION
	,PROPPING
	,SYSTEM_IMPERFECTION
	,SHRINKAGE
	,CREEP
	,LACK_OF_FIT
	,BUOYANCY
	,ICE
	,CURRENT
	,WAVE
	,RAIN
	,BRAKES
	,USERDEFINED
	,NOTDEFINED);

/** IfcActionTypeEnum */
export type IfcActionTypeEnum = ENUMERATION OF
	(PERMANENT_G
	,VARIABLE_Q
	,EXTRAORDINARY_A
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
	(OFFICE
	,SITE
	,HOME
	,DISTRIBUTIONPOINT
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
	,ROTARYWHEEL
	,RUNAROUNDCOILLOOP
	,HEATPIPE
	,TWINTOWERENTHALPYRECOVERYLOOPS
	,THERMOSIPHONSEALEDTUBEHEATEXCHANGERS
	,THERMOSIPHONCOILTYPEHEATEXCHANGERS
	,USERDEFINED
	,NOTDEFINED);

/** IfcAlarmTypeEnum */
export type IfcAlarmTypeEnum = ENUMERATION OF
	(BELL
	,BREAKGLASSBUTTON
	,LIGHT
	,MANUALPULLBOX
	,SIREN
	,WHISTLE
	,USERDEFINED
	,NOTDEFINED);

/** IfcAnalysisModelTypeEnum */
export type IfcAnalysisModelTypeEnum = ENUMERATION OF
	(IN_PLANE_LOADING_2D
	,OUT_PLANE_LOADING_2D
	,LOADING_3D
	,USERDEFINED
	,NOTDEFINED);

/** IfcAnalysisTheoryTypeEnum */
export type IfcAnalysisTheoryTypeEnum = ENUMERATION OF
	(FIRST_ORDER_THEORY
	,SECOND_ORDER_THEORY
	,THIRD_ORDER_THEORY
	,FULL_NONLINEAR_THEORY
	,USERDEFINED
	,NOTDEFINED);

/** IfcArithmeticOperatorEnum */
export type IfcArithmeticOperatorEnum = ENUMERATION OF
	(ADD
	,DIVIDE
	,MULTIPLY
	,SUBTRACT);

/** IfcAssemblyPlaceEnum */
export type IfcAssemblyPlaceEnum = ENUMERATION OF
	(SITE
	,FACTORY
	,NOTDEFINED);

/** IfcAudioVisualApplianceTypeEnum */
export type IfcAudioVisualApplianceTypeEnum = ENUMERATION OF
	(AMPLIFIER
	,CAMERA
	,DISPLAY
	,MICROPHONE
	,PLAYER
	,PROJECTOR
	,RECEIVER
	,SPEAKER
	,SWITCHER
	,TELEPHONE
	,TUNER
	,USERDEFINED
	,NOTDEFINED);

/** IfcBSplineCurveForm */
export type IfcBSplineCurveForm = ENUMERATION OF
	(POLYLINE_FORM
	,CIRCULAR_ARC
	,ELLIPTIC_ARC
	,PARABOLIC_ARC
	,HYPERBOLIC_ARC
	,UNSPECIFIED);

/** IfcBSplineSurfaceForm */
export type IfcBSplineSurfaceForm = ENUMERATION OF
	(PLANE_SURF
	,CYLINDRICAL_SURF
	,CONICAL_SURF
	,SPHERICAL_SURF
	,TOROIDAL_SURF
	,SURF_OF_REVOLUTION
	,RULED_SURF
	,GENERALISED_CONE
	,QUADRIC_SURF
	,SURF_OF_LINEAR_EXTRUSION
	,UNSPECIFIED);

/** IfcBeamTypeEnum */
export type IfcBeamTypeEnum = ENUMERATION OF
	(BEAM
	,JOIST
	,HOLLOWCORE
	,LINTEL
	,SPANDREL
	,T_BEAM
	,USERDEFINED
	,NOTDEFINED);

/** IfcBenchmarkEnum */
export type IfcBenchmarkEnum = ENUMERATION OF
	(GREATERTHAN
	,GREATERTHANOREQUALTO
	,LESSTHAN
	,LESSTHANOREQUALTO
	,EQUALTO
	,NOTEQUALTO
	,INCLUDES
	,NOTINCLUDES
	,INCLUDEDIN
	,NOTINCLUDEDIN);

/** IfcBoilerTypeEnum */
export type IfcBoilerTypeEnum = ENUMERATION OF
	(WATER
	,STEAM
	,USERDEFINED
	,NOTDEFINED);

/** IfcBooleanOperator */
export type IfcBooleanOperator = ENUMERATION OF
	(UNION
	,INTERSECTION
	,DIFFERENCE);

/** IfcBuildingElementPartTypeEnum */
export type IfcBuildingElementPartTypeEnum = ENUMERATION OF
	(INSULATION
	,PRECASTPANEL
	,USERDEFINED
	,NOTDEFINED);

/** IfcBuildingElementProxyTypeEnum */
export type IfcBuildingElementProxyTypeEnum = ENUMERATION OF
	(COMPLEX
	,ELEMENT
	,PARTIAL
	,PROVISIONFORVOID
	,PROVISIONFORSPACE
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

/** IfcBurnerTypeEnum */
export type IfcBurnerTypeEnum = ENUMERATION OF
	(USERDEFINED
	,NOTDEFINED);

/** IfcCableCarrierFittingTypeEnum */
export type IfcCableCarrierFittingTypeEnum = ENUMERATION OF
	(BEND
	,CROSS
	,REDUCER
	,TEE
	,USERDEFINED
	,NOTDEFINED);

/** IfcCableCarrierSegmentTypeEnum */
export type IfcCableCarrierSegmentTypeEnum = ENUMERATION OF
	(CABLELADDERSEGMENT
	,CABLETRAYSEGMENT
	,CABLETRUNKINGSEGMENT
	,CONDUITSEGMENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcCableFittingTypeEnum */
export type IfcCableFittingTypeEnum = ENUMERATION OF
	(CONNECTOR
	,ENTRY
	,EXIT
	,JUNCTION
	,TRANSITION
	,USERDEFINED
	,NOTDEFINED);

/** IfcCableSegmentTypeEnum */
export type IfcCableSegmentTypeEnum = ENUMERATION OF
	(BUSBARSEGMENT
	,CABLESEGMENT
	,CONDUCTORSEGMENT
	,CORESEGMENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcChangeActionEnum */
export type IfcChangeActionEnum = ENUMERATION OF
	(NOCHANGE
	,MODIFIED
	,ADDED
	,DELETED
	,NOTDEFINED);

/** IfcChillerTypeEnum */
export type IfcChillerTypeEnum = ENUMERATION OF
	(AIRCOOLED
	,WATERCOOLED
	,HEATRECOVERY
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
	,PILASTER
	,USERDEFINED
	,NOTDEFINED);

/** IfcCommunicationsApplianceTypeEnum */
export type IfcCommunicationsApplianceTypeEnum = ENUMERATION OF
	(ANTENNA
	,COMPUTER
	,FAX
	,GATEWAY
	,MODEM
	,NETWORKAPPLIANCE
	,NETWORKBRIDGE
	,NETWORKHUB
	,PRINTER
	,REPEATER
	,ROUTER
	,SCANNER
	,USERDEFINED
	,NOTDEFINED);

/** IfcComplexPropertyTemplateTypeEnum */
export type IfcComplexPropertyTemplateTypeEnum = ENUMERATION OF
	(P_COMPLEX
	,Q_COMPLEX);

/** IfcCompressorTypeEnum */
export type IfcCompressorTypeEnum = ENUMERATION OF
	(DYNAMIC
	,RECIPROCATING
	,ROTARY
	,SCROLL
	,TROCHOIDAL
	,SINGLESTAGE
	,BOOSTER
	,OPENTYPE
	,HERMETIC
	,SEMIHERMETIC
	,WELDEDSHELLHERMETIC
	,ROLLINGPISTON
	,ROTARYVANE
	,SINGLESCREW
	,TWINSCREW
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
	(ATPATH
	,ATSTART
	,ATEND
	,NOTDEFINED);

/** IfcConstraintEnum */
export type IfcConstraintEnum = ENUMERATION OF
	(HARD
	,SOFT
	,ADVISORY
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
	,NOTDEFINED
	,USERDEFINED);

/** IfcConstructionProductResourceTypeEnum */
export type IfcConstructionProductResourceTypeEnum = ENUMERATION OF
	(ASSEMBLY
	,FORMWORK
	,USERDEFINED
	,NOTDEFINED);

/** IfcControllerTypeEnum */
export type IfcControllerTypeEnum = ENUMERATION OF
	(FLOATING
	,PROGRAMMABLE
	,PROPORTIONAL
	,MULTIPOSITION
	,TWOPOSITION
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
	(NATURALDRAFT
	,MECHANICALINDUCEDDRAFT
	,MECHANICALFORCEDDRAFT
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
	,TENDER
	,PRICEDBILLOFQUANTITIES
	,UNPRICEDBILLOFQUANTITIES
	,SCHEDULEOFRATES
	,USERDEFINED
	,NOTDEFINED);

/** IfcCoveringTypeEnum */
export type IfcCoveringTypeEnum = ENUMERATION OF
	(CEILING
	,FLOORING
	,CLADDING
	,ROOFING
	,MOLDING
	,SKIRTINGBOARD
	,INSULATION
	,MEMBRANE
	,SLEEVING
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
	(ANGULARVELOCITYUNIT
	,AREADENSITYUNIT
	,COMPOUNDPLANEANGLEUNIT
	,DYNAMICVISCOSITYUNIT
	,HEATFLUXDENSITYUNIT
	,INTEGERCOUNTRATEUNIT
	,ISOTHERMALMOISTURECAPACITYUNIT
	,KINEMATICVISCOSITYUNIT
	,LINEARVELOCITYUNIT
	,MASSDENSITYUNIT
	,MASSFLOWRATEUNIT
	,MOISTUREDIFFUSIVITYUNIT
	,MOLECULARWEIGHTUNIT
	,SPECIFICHEATCAPACITYUNIT
	,THERMALADMITTANCEUNIT
	,THERMALCONDUCTANCEUNIT
	,THERMALRESISTANCEUNIT
	,THERMALTRANSMITTANCEUNIT
	,VAPORPERMEABILITYUNIT
	,VOLUMETRICFLOWRATEUNIT
	,ROTATIONALFREQUENCYUNIT
	,TORQUEUNIT
	,MOMENTOFINERTIAUNIT
	,LINEARMOMENTUNIT
	,LINEARFORCEUNIT
	,PLANARFORCEUNIT
	,MODULUSOFELASTICITYUNIT
	,SHEARMODULUSUNIT
	,LINEARSTIFFNESSUNIT
	,ROTATIONALSTIFFNESSUNIT
	,MODULUSOFSUBGRADEREACTIONUNIT
	,ACCELERATIONUNIT
	,CURVATUREUNIT
	,HEATINGVALUEUNIT
	,IONCONCENTRATIONUNIT
	,LUMINOUSINTENSITYDISTRIBUTIONUNIT
	,MASSPERLENGTHUNIT
	,MODULUSOFLINEARSUBGRADEREACTIONUNIT
	,MODULUSOFROTATIONALSUBGRADEREACTIONUNIT
	,PHUNIT
	,ROTATIONALMASSUNIT
	,SECTIONAREAINTEGRALUNIT
	,SECTIONMODULUSUNIT
	,SOUNDPOWERLEVELUNIT
	,SOUNDPOWERUNIT
	,SOUNDPRESSURELEVELUNIT
	,SOUNDPRESSUREUNIT
	,TEMPERATUREGRADIENTUNIT
	,TEMPERATURERATEOFCHANGEUNIT
	,THERMALEXPANSIONCOEFFICIENTUNIT
	,WARPINGCONSTANTUNIT
	,WARPINGMOMENTUNIT
	,USERDEFINED);

/** IfcDirectionSenseEnum */
export type IfcDirectionSenseEnum = ENUMERATION OF
	(POSITIVE
	,NEGATIVE);

/** IfcDiscreteAccessoryTypeEnum */
export type IfcDiscreteAccessoryTypeEnum = ENUMERATION OF
	(ANCHORPLATE
	,BRACKET
	,SHOE
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
	,USERDEFINED
	,NOTDEFINED);

/** IfcDistributionSystemEnum */
export type IfcDistributionSystemEnum = ENUMERATION OF
	(AIRCONDITIONING
	,AUDIOVISUAL
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
	,FUEL
	,GAS
	,HAZARDOUS
	,HEATING
	,LIGHTING
	,LIGHTNINGPROTECTION
	,MUNICIPALSOLIDWASTE
	,OIL
	,OPERATIONAL
	,POWERGENERATION
	,RAINWATER
	,REFRIGERATION
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
	(PUBLIC
	,RESTRICTED
	,CONFIDENTIAL
	,PERSONAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcDocumentStatusEnum */
export type IfcDocumentStatusEnum = ENUMERATION OF
	(DRAFT
	,FINALDRAFT
	,FINAL
	,REVISION
	,NOTDEFINED);

/** IfcDoorPanelOperationEnum */
export type IfcDoorPanelOperationEnum = ENUMERATION OF
	(SWINGING
	,DOUBLE_ACTING
	,SLIDING
	,FOLDING
	,REVOLVING
	,ROLLINGUP
	,FIXEDPANEL
	,USERDEFINED
	,NOTDEFINED);

/** IfcDoorPanelPositionEnum */
export type IfcDoorPanelPositionEnum = ENUMERATION OF
	(LEFT
	,MIDDLE
	,RIGHT
	,NOTDEFINED);

/** IfcDoorStyleConstructionEnum */
export type IfcDoorStyleConstructionEnum = ENUMERATION OF
	(ALUMINIUM
	,HIGH_GRADE_STEEL
	,STEEL
	,WOOD
	,ALUMINIUM_WOOD
	,ALUMINIUM_PLASTIC
	,PLASTIC
	,USERDEFINED
	,NOTDEFINED);

/** IfcDoorStyleOperationEnum */
export type IfcDoorStyleOperationEnum = ENUMERATION OF
	(SINGLE_SWING_LEFT
	,SINGLE_SWING_RIGHT
	,DOUBLE_DOOR_SINGLE_SWING
	,DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_LEFT
	,DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_RIGHT
	,DOUBLE_SWING_LEFT
	,DOUBLE_SWING_RIGHT
	,DOUBLE_DOOR_DOUBLE_SWING
	,SLIDING_TO_LEFT
	,SLIDING_TO_RIGHT
	,DOUBLE_DOOR_SLIDING
	,FOLDING_TO_LEFT
	,FOLDING_TO_RIGHT
	,DOUBLE_DOOR_FOLDING
	,REVOLVING
	,ROLLINGUP
	,USERDEFINED
	,NOTDEFINED);

/** IfcDoorTypeEnum */
export type IfcDoorTypeEnum = ENUMERATION OF
	(DOOR
	,GATE
	,TRAPDOOR
	,USERDEFINED
	,NOTDEFINED);

/** IfcDoorTypeOperationEnum */
export type IfcDoorTypeOperationEnum = ENUMERATION OF
	(SINGLE_SWING_LEFT
	,SINGLE_SWING_RIGHT
	,DOUBLE_DOOR_SINGLE_SWING
	,DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_LEFT
	,DOUBLE_DOOR_SINGLE_SWING_OPPOSITE_RIGHT
	,DOUBLE_SWING_LEFT
	,DOUBLE_SWING_RIGHT
	,DOUBLE_DOOR_DOUBLE_SWING
	,SLIDING_TO_LEFT
	,SLIDING_TO_RIGHT
	,DOUBLE_DOOR_SLIDING
	,FOLDING_TO_LEFT
	,FOLDING_TO_RIGHT
	,DOUBLE_DOOR_FOLDING
	,REVOLVING
	,ROLLINGUP
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
	(RIGIDSEGMENT
	,FLEXIBLESEGMENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcDuctSilencerTypeEnum */
export type IfcDuctSilencerTypeEnum = ENUMERATION OF
	(FLATOVAL
	,RECTANGULAR
	,ROUND
	,USERDEFINED
	,NOTDEFINED);

/** IfcElectricApplianceTypeEnum */
export type IfcElectricApplianceTypeEnum = ENUMERATION OF
	(DISHWASHER
	,ELECTRICCOOKER
	,FREESTANDINGELECTRICHEATER
	,FREESTANDINGFAN
	,FREESTANDINGWATERHEATER
	,FREESTANDINGWATERCOOLER
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
	,CAPACITORBANK
	,HARMONICFILTER
	,INDUCTORBANK
	,UPS
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
	(TIMECLOCK
	,TIMEDELAY
	,RELAY
	,USERDEFINED
	,NOTDEFINED);

/** IfcElementAssemblyTypeEnum */
export type IfcElementAssemblyTypeEnum = ENUMERATION OF
	(ACCESSORY_ASSEMBLY
	,ARCH
	,BEAM_GRID
	,BRACED_FRAME
	,GIRDER
	,REINFORCEMENT_UNIT
	,RIGID_FRAME
	,SLAB_FIELD
	,TRUSS
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
	(DIRECTEVAPORATIVERANDOMMEDIAAIRCOOLER
	,DIRECTEVAPORATIVERIGIDMEDIAAIRCOOLER
	,DIRECTEVAPORATIVESLINGERSPACKAGEDAIRCOOLER
	,DIRECTEVAPORATIVEPACKAGEDROTARYAIRCOOLER
	,DIRECTEVAPORATIVEAIRWASHER
	,INDIRECTEVAPORATIVEPACKAGEAIRCOOLER
	,INDIRECTEVAPORATIVEWETCOIL
	,INDIRECTEVAPORATIVECOOLINGTOWERORCOILCOOLER
	,INDIRECTDIRECTCOMBINATION
	,USERDEFINED
	,NOTDEFINED);

/** IfcEvaporatorTypeEnum */
export type IfcEvaporatorTypeEnum = ENUMERATION OF
	(DIRECTEXPANSION
	,DIRECTEXPANSIONSHELLANDTUBE
	,DIRECTEXPANSIONTUBEINTUBE
	,DIRECTEXPANSIONBRAZEDPLATE
	,FLOODEDSHELLANDTUBE
	,SHELLANDCOIL
	,USERDEFINED
	,NOTDEFINED);

/** IfcEventTriggerTypeEnum */
export type IfcEventTriggerTypeEnum = ENUMERATION OF
	(EVENTRULE
	,EVENTMESSAGE
	,EVENTTIME
	,EVENTCOMPLEX
	,USERDEFINED
	,NOTDEFINED);

/** IfcEventTypeEnum */
export type IfcEventTypeEnum = ENUMERATION OF
	(STARTEVENT
	,ENDEVENT
	,INTERMEDIATEEVENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcExternalSpatialElementTypeEnum */
export type IfcExternalSpatialElementTypeEnum = ENUMERATION OF
	(EXTERNAL
	,EXTERNAL_EARTH
	,EXTERNAL_WATER
	,EXTERNAL_FIRE
	,USERDEFINED
	,NOTDEFINED);

/** IfcFanTypeEnum */
export type IfcFanTypeEnum = ENUMERATION OF
	(CENTRIFUGALFORWARDCURVED
	,CENTRIFUGALRADIAL
	,CENTRIFUGALBACKWARDINCLINEDCURVED
	,CENTRIFUGALAIRFOIL
	,TUBEAXIAL
	,VANEAXIAL
	,PROPELLORAXIAL
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
	,HOSEREEL
	,SPRINKLER
	,SPRINKLERDEFLECTOR
	,USERDEFINED
	,NOTDEFINED);

/** IfcFlowDirectionEnum */
export type IfcFlowDirectionEnum = ENUMERATION OF
	(SOURCE
	,SINK
	,SOURCEANDSINK
	,NOTDEFINED);

/** IfcFlowInstrumentTypeEnum */
export type IfcFlowInstrumentTypeEnum = ENUMERATION OF
	(PRESSUREGAUGE
	,THERMOMETER
	,AMMETER
	,FREQUENCYMETER
	,POWERFACTORMETER
	,PHASEANGLEMETER
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
	(CHAIR
	,TABLE
	,DESK
	,BED
	,FILECABINET
	,SHELF
	,SOFA
	,USERDEFINED
	,NOTDEFINED);

/** IfcGeographicElementTypeEnum */
export type IfcGeographicElementTypeEnum = ENUMERATION OF
	(TERRAIN
	,USERDEFINED
	,NOTDEFINED);

/** IfcGeometricProjectionEnum */
export type IfcGeometricProjectionEnum = ENUMERATION OF
	(GRAPH_VIEW
	,SKETCH_VIEW
	,MODEL_VIEW
	,PLAN_VIEW
	,REFLECTED_PLAN_VIEW
	,SECTION_VIEW
	,ELEVATION_VIEW
	,USERDEFINED
	,NOTDEFINED);

/** IfcGlobalOrLocalEnum */
export type IfcGlobalOrLocalEnum = ENUMERATION OF
	(GLOBAL_COORDS
	,LOCAL_COORDS);

/** IfcGridTypeEnum */
export type IfcGridTypeEnum = ENUMERATION OF
	(RECTANGULAR
	,RADIAL
	,TRIANGULAR
	,IRREGULAR
	,USERDEFINED
	,NOTDEFINED);

/** IfcHeatExchangerTypeEnum */
export type IfcHeatExchangerTypeEnum = ENUMERATION OF
	(PLATE
	,SHELLANDTUBE
	,USERDEFINED
	,NOTDEFINED);

/** IfcHumidifierTypeEnum */
export type IfcHumidifierTypeEnum = ENUMERATION OF
	(STEAMINJECTION
	,ADIABATICAIRWASHER
	,ADIABATICPAN
	,ADIABATICWETTEDELEMENT
	,ADIABATICATOMIZING
	,ADIABATICULTRASONIC
	,ADIABATICRIGIDMEDIA
	,ADIABATICCOMPRESSEDAIRNOZZLE
	,ASSISTEDELECTRIC
	,ASSISTEDNATURALGAS
	,ASSISTEDPROPANE
	,ASSISTEDBUTANE
	,ASSISTEDSTEAM
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
	(INTERNAL
	,EXTERNAL
	,EXTERNAL_EARTH
	,EXTERNAL_WATER
	,EXTERNAL_FIRE
	,NOTDEFINED);

/** IfcInventoryTypeEnum */
export type IfcInventoryTypeEnum = ENUMERATION OF
	(ASSETINVENTORY
	,SPACEINVENTORY
	,FURNITUREINVENTORY
	,USERDEFINED
	,NOTDEFINED);

/** IfcJunctionBoxTypeEnum */
export type IfcJunctionBoxTypeEnum = ENUMERATION OF
	(DATA
	,POWER
	,USERDEFINED
	,NOTDEFINED);

/** IfcKnotType */
export type IfcKnotType = ENUMERATION OF
	(UNIFORM_KNOTS
	,QUASI_UNIFORM_KNOTS
	,PIECEWISE_BEZIER_KNOTS
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
	(POINTSOURCE
	,DIRECTIONSOURCE
	,SECURITYLIGHTING
	,USERDEFINED
	,NOTDEFINED);

/** IfcLoadGroupTypeEnum */
export type IfcLoadGroupTypeEnum = ENUMERATION OF
	(LOAD_GROUP
	,LOAD_CASE
	,LOAD_COMBINATION
	,USERDEFINED
	,NOTDEFINED);

/** IfcLogicalOperatorEnum */
export type IfcLogicalOperatorEnum = ENUMERATION OF
	(LOGICALAND
	,LOGICALOR
	,LOGICALXOR
	,LOGICALNOTAND
	,LOGICALNOTOR);

/** IfcMechanicalFastenerTypeEnum */
export type IfcMechanicalFastenerTypeEnum = ENUMERATION OF
	(ANCHORBOLT
	,BOLT
	,DOWEL
	,NAIL
	,NAILPLATE
	,RIVET
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
	(BRACE
	,CHORD
	,COLLAR
	,MEMBER
	,MULLION
	,PLATE
	,POST
	,PURLIN
	,RAFTER
	,STRINGER
	,STRUT
	,STUD
	,USERDEFINED
	,NOTDEFINED);

/** IfcMotorConnectionTypeEnum */
export type IfcMotorConnectionTypeEnum = ENUMERATION OF
	(BELTDRIVE
	,COUPLING
	,DIRECTDRIVE
	,USERDEFINED
	,NOTDEFINED);

/** IfcNullStyle */
export type IfcNullStyle = ENUMERATION OF
	(NULL);

/** IfcObjectTypeEnum */
export type IfcObjectTypeEnum = ENUMERATION OF
	(PRODUCT
	,PROCESS
	,CONTROL
	,RESOURCE
	,ACTOR
	,GROUP
	,PROJECT
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
	,POWEROUTLET
	,DATAOUTLET
	,TELEPHONEOUTLET
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
	,DRIVEN
	,JETGROUTING
	,COHESION
	,FRICTION
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
	,RIGIDSEGMENT
	,GUTTER
	,SPOOL
	,USERDEFINED
	,NOTDEFINED);

/** IfcPlateTypeEnum */
export type IfcPlateTypeEnum = ENUMERATION OF
	(CURTAIN_PANEL
	,SHEET
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
	(CURVE
	,AREA);

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
	(USERDEFINED
	,NOTDEFINED);

/** IfcPropertySetTemplateTypeEnum */
export type IfcPropertySetTemplateTypeEnum = ENUMERATION OF
	(PSET_TYPEDRIVENONLY
	,PSET_TYPEDRIVENOVERRIDE
	,PSET_OCCURRENCEDRIVEN
	,PSET_PERFORMANCEDRIVEN
	,QTO_TYPEDRIVENONLY
	,QTO_TYPEDRIVENOVERRIDE
	,QTO_OCCURRENCEDRIVEN
	,NOTDEFINED);

/** IfcProtectiveDeviceTrippingUnitTypeEnum */
export type IfcProtectiveDeviceTrippingUnitTypeEnum = ENUMERATION OF
	(ELECTRONIC
	,ELECTROMAGNETIC
	,RESIDUALCURRENT
	,THERMAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcProtectiveDeviceTypeEnum */
export type IfcProtectiveDeviceTypeEnum = ENUMERATION OF
	(CIRCUITBREAKER
	,EARTHLEAKAGECIRCUITBREAKER
	,EARTHINGSWITCH
	,FUSEDISCONNECTOR
	,RESIDUALCURRENTCIRCUITBREAKER
	,RESIDUALCURRENTSWITCH
	,VARISTOR
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

/** IfcRailingTypeEnum */
export type IfcRailingTypeEnum = ENUMERATION OF
	(HANDRAIL
	,GUARDRAIL
	,BALUSTRADE
	,USERDEFINED
	,NOTDEFINED);

/** IfcRampFlightTypeEnum */
export type IfcRampFlightTypeEnum = ENUMERATION OF
	(STRAIGHT
	,SPIRAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcRampTypeEnum */
export type IfcRampTypeEnum = ENUMERATION OF
	(STRAIGHT_RUN_RAMP
	,TWO_STRAIGHT_RUN_RAMP
	,QUARTER_TURN_RAMP
	,TWO_QUARTER_TURN_RAMP
	,HALF_TURN_RAMP
	,SPIRAL_RAMP
	,USERDEFINED
	,NOTDEFINED);

/** IfcRecurrenceTypeEnum */
export type IfcRecurrenceTypeEnum = ENUMERATION OF
	(DAILY
	,WEEKLY
	,MONTHLY_BY_DAY_OF_MONTH
	,MONTHLY_BY_POSITION
	,BY_DAY_COUNT
	,BY_WEEKDAY_COUNT
	,YEARLY_BY_DAY_OF_MONTH
	,YEARLY_BY_POSITION);

/** IfcReflectanceMethodEnum */
export type IfcReflectanceMethodEnum = ENUMERATION OF
	(BLINN
	,FLAT
	,GLASS
	,MATT
	,METAL
	,MIRROR
	,PHONG
	,PLASTIC
	,STRAUSS
	,NOTDEFINED);

/** IfcReinforcingBarRoleEnum */
export type IfcReinforcingBarRoleEnum = ENUMERATION OF
	(MAIN
	,SHEAR
	,LIGATURE
	,STUD
	,PUNCHING
	,EDGE
	,RING
	,ANCHORING
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
	,STUD
	,USERDEFINED
	,NOTDEFINED);

/** IfcReinforcingMeshTypeEnum */
export type IfcReinforcingMeshTypeEnum = ENUMERATION OF
	(USERDEFINED
	,NOTDEFINED);

/** IfcRoleEnum */
export type IfcRoleEnum = ENUMERATION OF
	(SUPPLIER
	,MANUFACTURER
	,CONTRACTOR
	,SUBCONTRACTOR
	,ARCHITECT
	,STRUCTURALENGINEER
	,COSTENGINEER
	,CLIENT
	,BUILDINGOWNER
	,BUILDINGOPERATOR
	,MECHANICALENGINEER
	,ELECTRICALENGINEER
	,PROJECTMANAGER
	,FACILITIESMANAGER
	,CIVILENGINEER
	,COMMISSIONINGENGINEER
	,ENGINEER
	,OWNER
	,CONSULTANT
	,CONSTRUCTIONMANAGER
	,FIELDCONSTRUCTIONMANAGER
	,RESELLER
	,USERDEFINED);

/** IfcRoofTypeEnum */
export type IfcRoofTypeEnum = ENUMERATION OF
	(FLAT_ROOF
	,SHED_ROOF
	,GABLE_ROOF
	,HIP_ROOF
	,HIPPED_GABLE_ROOF
	,GAMBREL_ROOF
	,MANSARD_ROOF
	,BARREL_ROOF
	,RAINBOW_ROOF
	,BUTTERFLY_ROOF
	,PAVILION_ROOF
	,DOME_ROOF
	,FREEFORM
	,USERDEFINED
	,NOTDEFINED);

/** IfcSIPrefix */
export type IfcSIPrefix = ENUMERATION OF
	(EXA
	,PETA
	,TERA
	,GIGA
	,MEGA
	,KILO
	,HECTO
	,DECA
	,DECI
	,CENTI
	,MILLI
	,MICRO
	,NANO
	,PICO
	,FEMTO
	,ATTO);

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
	,SHOWER
	,SINK
	,SANITARYFOUNTAIN
	,TOILETPAN
	,URINAL
	,WASHHANDBASIN
	,WCSEAT
	,USERDEFINED
	,NOTDEFINED);

/** IfcSectionTypeEnum */
export type IfcSectionTypeEnum = ENUMERATION OF
	(UNIFORM
	,TAPERED);

/** IfcSensorTypeEnum */
export type IfcSensorTypeEnum = ENUMERATION OF
	(COSENSOR
	,CO2SENSOR
	,CONDUCTANCESENSOR
	,CONTACTSENSOR
	,FIRESENSOR
	,FLOWSENSOR
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
	,PHSENSOR
	,PRESSURESENSOR
	,RADIATIONSENSOR
	,RADIOACTIVITYSENSOR
	,SMOKESENSOR
	,SOUNDSENSOR
	,TEMPERATURESENSOR
	,WINDSENSOR
	,USERDEFINED
	,NOTDEFINED);

/** IfcSequenceEnum */
export type IfcSequenceEnum = ENUMERATION OF
	(START_START
	,START_FINISH
	,FINISH_START
	,FINISH_FINISH
	,USERDEFINED
	,NOTDEFINED);

/** IfcShadingDeviceTypeEnum */
export type IfcShadingDeviceTypeEnum = ENUMERATION OF
	(JALOUSIE
	,SHUTTER
	,AWNING
	,USERDEFINED
	,NOTDEFINED);

/** IfcSimplePropertyTemplateTypeEnum */
export type IfcSimplePropertyTemplateTypeEnum = ENUMERATION OF
	(P_SINGLEVALUE
	,P_ENUMERATEDVALUE
	,P_BOUNDEDVALUE
	,P_LISTVALUE
	,P_TABLEVALUE
	,P_REFERENCEVALUE
	,Q_LENGTH
	,Q_AREA
	,Q_VOLUME
	,Q_COUNT
	,Q_WEIGHT
	,Q_TIME);

/** IfcSlabTypeEnum */
export type IfcSlabTypeEnum = ENUMERATION OF
	(FLOOR
	,ROOF
	,LANDING
	,BASESLAB
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
	(SPACE
	,PARKING
	,GFA
	,INTERNAL
	,EXTERNAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcSpatialZoneTypeEnum */
export type IfcSpatialZoneTypeEnum = ENUMERATION OF
	(CONSTRUCTION
	,FIRESAFETY
	,LIGHTING
	,OCCUPANCY
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
	(STRAIGHT
	,WINDER
	,SPIRAL
	,CURVED
	,FREEFORM
	,USERDEFINED
	,NOTDEFINED);

/** IfcStairTypeEnum */
export type IfcStairTypeEnum = ENUMERATION OF
	(STRAIGHT_RUN_STAIR
	,TWO_STRAIGHT_RUN_STAIR
	,QUARTER_WINDING_STAIR
	,QUARTER_TURN_STAIR
	,HALF_WINDING_STAIR
	,HALF_TURN_STAIR
	,TWO_QUARTER_WINDING_STAIR
	,TWO_QUARTER_TURN_STAIR
	,THREE_QUARTER_WINDING_STAIR
	,THREE_QUARTER_TURN_STAIR
	,SPIRAL_STAIR
	,DOUBLE_RETURN_STAIR
	,CURVED_RUN_STAIR
	,TWO_CURVED_RUN_STAIR
	,USERDEFINED
	,NOTDEFINED);

/** IfcStateEnum */
export type IfcStateEnum = ENUMERATION OF
	(READWRITE
	,READONLY
	,LOCKED
	,READWRITELOCKED
	,READONLYLOCKED);

/** IfcStructuralCurveActivityTypeEnum */
export type IfcStructuralCurveActivityTypeEnum = ENUMERATION OF
	(CONST
	,LINEAR
	,POLYGONAL
	,EQUIDISTANT
	,SINUS
	,PARABOLA
	,DISCRETE
	,USERDEFINED
	,NOTDEFINED);

/** IfcStructuralCurveMemberTypeEnum */
export type IfcStructuralCurveMemberTypeEnum = ENUMERATION OF
	(RIGID_JOINED_MEMBER
	,PIN_JOINED_MEMBER
	,CABLE
	,TENSION_MEMBER
	,COMPRESSION_MEMBER
	,USERDEFINED
	,NOTDEFINED);

/** IfcStructuralSurfaceActivityTypeEnum */
export type IfcStructuralSurfaceActivityTypeEnum = ENUMERATION OF
	(CONST
	,BILINEAR
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
	(MARK
	,TAG
	,TREATMENT
	,USERDEFINED
	,NOTDEFINED);

/** IfcSurfaceSide */
export type IfcSurfaceSide = ENUMERATION OF
	(POSITIVE
	,NEGATIVE
	,BOTH);

/** IfcSwitchingDeviceTypeEnum */
export type IfcSwitchingDeviceTypeEnum = ENUMERATION OF
	(CONTACTOR
	,DIMMERSWITCH
	,EMERGENCYSTOP
	,KEYPAD
	,MOMENTARYSWITCH
	,SELECTORSWITCH
	,STARTER
	,SWITCHDISCONNECTOR
	,TOGGLESWITCH
	,USERDEFINED
	,NOTDEFINED);

/** IfcSystemFurnitureElementTypeEnum */
export type IfcSystemFurnitureElementTypeEnum = ENUMERATION OF
	(PANEL
	,WORKSURFACE
	,USERDEFINED
	,NOTDEFINED);

/** IfcTankTypeEnum */
export type IfcTankTypeEnum = ENUMERATION OF
	(BASIN
	,BREAKPRESSURE
	,EXPANSION
	,FEEDANDEXPANSION
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
	(ATTENDANCE
	,CONSTRUCTION
	,DEMOLITION
	,DISMANTLE
	,DISPOSAL
	,INSTALLATION
	,LOGISTIC
	,MAINTENANCE
	,MOVE
	,OPERATION
	,REMOVAL
	,RENOVATION
	,USERDEFINED
	,NOTDEFINED);

/** IfcTendonAnchorTypeEnum */
export type IfcTendonAnchorTypeEnum = ENUMERATION OF
	(COUPLER
	,FIXED_END
	,TENSIONING_END
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
	(LEFT
	,RIGHT
	,UP
	,DOWN);

/** IfcTimeSeriesDataTypeEnum */
export type IfcTimeSeriesDataTypeEnum = ENUMERATION OF
	(CONTINUOUS
	,DISCRETE
	,DISCRETEBINARY
	,PIECEWISEBINARY
	,PIECEWISECONSTANT
	,PIECEWISECONTINUOUS
	,NOTDEFINED);

/** IfcTransformerTypeEnum */
export type IfcTransformerTypeEnum = ENUMERATION OF
	(CURRENT
	,FREQUENCY
	,INVERTER
	,RECTIFIER
	,VOLTAGE
	,USERDEFINED
	,NOTDEFINED);

/** IfcTransitionCode */
export type IfcTransitionCode = ENUMERATION OF
	(DISCONTINUOUS
	,CONTINUOUS
	,CONTSAMEGRADIENT
	,CONTSAMEGRADIENTSAMECURVATURE);

/** IfcTransportElementTypeEnum */
export type IfcTransportElementTypeEnum = ENUMERATION OF
	(ELEVATOR
	,ESCALATOR
	,MOVINGWALKWAY
	,CRANEWAY
	,LIFTINGGEAR
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
	,CONTROLPANEL
	,GASDETECTIONPANEL
	,INDICATORPANEL
	,MIMICPANEL
	,HUMIDISTAT
	,THERMOSTAT
	,WEATHERSTATION
	,USERDEFINED
	,NOTDEFINED);

/** IfcUnitaryEquipmentTypeEnum */
export type IfcUnitaryEquipmentTypeEnum = ENUMERATION OF
	(AIRHANDLER
	,AIRCONDITIONINGUNIT
	,DEHUMIDIFIER
	,SPLITSYSTEM
	,ROOFTOPUNIT
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
	,DRAWOFFCOCK
	,DOUBLECHECK
	,DOUBLEREGULATING
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

/** IfcVibrationIsolatorTypeEnum */
export type IfcVibrationIsolatorTypeEnum = ENUMERATION OF
	(COMPRESSION
	,SPRING
	,USERDEFINED
	,NOTDEFINED);

/** IfcVoidingFeatureTypeEnum */
export type IfcVoidingFeatureTypeEnum = ENUMERATION OF
	(CUTOUT
	,NOTCH
	,HOLE
	,MITER
	,CHAMFER
	,EDGE
	,USERDEFINED
	,NOTDEFINED);

/** IfcWallTypeEnum */
export type IfcWallTypeEnum = ENUMERATION OF
	(MOVABLE
	,PARAPET
	,PARTITIONING
	,PLUMBINGWALL
	,SHEAR
	,SOLIDWALL
	,STANDARD
	,POLYGONAL
	,ELEMENTEDWALL
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
	(SIDEHUNGRIGHTHAND
	,SIDEHUNGLEFTHAND
	,TILTANDTURNRIGHTHAND
	,TILTANDTURNLEFTHAND
	,TOPHUNG
	,BOTTOMHUNG
	,PIVOTHORIZONTAL
	,PIVOTVERTICAL
	,SLIDINGHORIZONTAL
	,SLIDINGVERTICAL
	,REMOVABLECASEMENT
	,FIXEDCASEMENT
	,OTHEROPERATION
	,NOTDEFINED);

/** IfcWindowPanelPositionEnum */
export type IfcWindowPanelPositionEnum = ENUMERATION OF
	(LEFT
	,MIDDLE
	,RIGHT
	,BOTTOM
	,TOP
	,NOTDEFINED);

/** IfcWindowStyleConstructionEnum */
export type IfcWindowStyleConstructionEnum = ENUMERATION OF
	(ALUMINIUM
	,HIGH_GRADE_STEEL
	,STEEL
	,WOOD
	,ALUMINIUM_WOOD
	,PLASTIC
	,OTHER_CONSTRUCTION
	,NOTDEFINED);

/** IfcWindowStyleOperationEnum */
export type IfcWindowStyleOperationEnum = ENUMERATION OF
	(SINGLE_PANEL
	,DOUBLE_PANEL_VERTICAL
	,DOUBLE_PANEL_HORIZONTAL
	,TRIPLE_PANEL_VERTICAL
	,TRIPLE_PANEL_BOTTOM
	,TRIPLE_PANEL_TOP
	,TRIPLE_PANEL_LEFT
	,TRIPLE_PANEL_RIGHT
	,TRIPLE_PANEL_HORIZONTAL
	,USERDEFINED
	,NOTDEFINED);

/** IfcWindowTypeEnum */
export type IfcWindowTypeEnum = ENUMERATION OF
	(WINDOW
	,SKYLIGHT
	,LIGHTDOME
	,USERDEFINED
	,NOTDEFINED);

/** IfcWindowTypePartitioningEnum */
export type IfcWindowTypePartitioningEnum = ENUMERATION OF
	(SINGLE_PANEL
	,DOUBLE_PANEL_VERTICAL
	,DOUBLE_PANEL_HORIZONTAL
	,TRIPLE_PANEL_VERTICAL
	,TRIPLE_PANEL_BOTTOM
	,TRIPLE_PANEL_TOP
	,TRIPLE_PANEL_LEFT
	,TRIPLE_PANEL_RIGHT
	,TRIPLE_PANEL_HORIZONTAL
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

/** IfcPresentationStyleSelect */
export type IfcPresentationStyleSelect = SELECT
	(IfcCurveStyle
	,IfcFillAreaStyle
	,IfcNullStyle
	,IfcSurfaceStyle
	,IfcTextStyle);

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
	,IfcTimeStamp);

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

/** IfcSpecularHighlightSelect */
export type IfcSpecularHighlightSelect = SELECT
	(IfcSpecularExponent
	,IfcSpecularRoughness);

/** IfcStructuralActivityAssignmentSelect */
export type IfcStructuralActivityAssignmentSelect = SELECT
	(IfcElement
	,IfcStructuralItem);

/** IfcStyleAssignmentSelect */
export type IfcStyleAssignmentSelect = SELECT
	(IfcPresentationStyle
	,IfcPresentationStyleAssignment);

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

